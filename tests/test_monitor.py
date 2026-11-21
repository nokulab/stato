import contextlib
import io
import json
from pathlib import Path
import socket
import ssl
import urllib.error
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch, Mock
from scripts import monitor


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/slow':
            time.sleep(.15)
        code = 503 if self.path == '/failure' else 204 if self.path == '/empty' else 302 if self.path == '/redirect' else 200
        self.send_response(code)
        if code == 302:
            self.send_header('Location', 'http://127.0.0.1/private-secret')
        self.end_headers()

    def log_message(self, *args):
        pass


class MonitorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def entry(self, path='/'):
        return {'id': 'test', 'name': 'Test endpoint', 'url': f'http://127.0.0.1:{self.server.server_port}{path}'}

    def local_probe(self, entry):
        # Permit our local test fixture only; production rejects private addresses.
        with patch.object(monitor.ipaddress, 'ip_address', return_value=Mock(is_global=True)):
            return monitor.probe(entry)

    def test_success_and_expected_error_status(self):
        result = self.local_probe(self.entry())
        self.assertEqual(result['status'], 'up')
        self.assertIsInstance(result['response_ms'], int)
        self.assertIsNone(result['reason'])
        self.assertEqual(self.local_probe({**self.entry('/failure'), 'expected_status_codes': [503]})['status'], 'up')
        self.assertEqual(self.local_probe({**self.entry('/empty'), 'expected_status_codes': [204]})['status'], 'up')

    def test_unexpected_status_and_no_redirect(self):
        result = self.local_probe(self.entry('/failure'))
        self.assertEqual(result['status'], 'down')
        self.assertEqual(result['reason'], 'Unexpected HTTP status 503.')
        self.assertEqual(self.local_probe(self.entry('/redirect'))['reason'], 'Unexpected HTTP status 302.')

    def test_timeout_and_process_deadline(self):
        self.assertEqual(self.local_probe({**self.entry('/slow'), 'timeout': .02})['reason'], monitor.REASONS['timeout'])
        with patch.object(monitor.subprocess, 'run', side_effect=subprocess.TimeoutExpired('probe', 1)):
            self.assertEqual(monitor.attempt(self.entry())['reason'], monitor.REASONS['timeout'])

    def test_private_is_unknown(self):
        self.assertEqual(monitor.probe(self.entry())['status'], 'unknown')
        self.assertEqual(monitor.check(self.entry())['reason'], monitor.REASONS['private'])

    def test_retry_is_bounded_and_can_recover(self):
        down = {'status': 'down', 'reason': monitor.REASONS['network'], 'response_ms': None}
        up = {'status': 'up', 'reason': None, 'response_ms': 12}
        with patch.object(monitor, 'attempt', side_effect=[down, up]) as attempt, patch.object(monitor.time, 'sleep'):
            self.assertEqual(monitor.check(self.entry())['status'], 'up')
            self.assertEqual(attempt.call_count, 2)
        with patch.object(monitor, 'attempt', return_value=down) as attempt, patch.object(monitor.time, 'sleep'):
            self.assertEqual(monitor.check(self.entry())['status'], 'down')
            self.assertEqual(attempt.call_count, 2)

    def test_reason_codes_distinguish_response_network_and_tls(self):
        self.assertEqual(self.local_probe(self.entry('/failure'))['reason_code'], 'http_status')
        self.assertEqual(self.local_probe({**self.entry('/slow'), 'timeout': .02})['reason_code'], 'timeout')
        for failure, code in [(socket.gaierror(), 'network'), (ConnectionRefusedError(), 'network'),
                              (ssl.SSLCertVerificationError(), 'tls'),
                              (urllib.error.URLError(ssl.SSLCertVerificationError()), 'tls')]:
            with patch.object(monitor.socket, 'getaddrinfo', side_effect=failure):
                self.assertEqual(monitor.probe(self.entry())['reason_code'], code)

    def test_optional_details_validation_and_publication(self):
        details = '<img src=x onerror=alert(1)> Public service & status'
        for entry in [self.entry(), {**self.entry(), 'details': details}]:
            self.assertTrue(monitor.validate(entry))
            result = self.collect_text(json.dumps([entry]))['servers'][0]
            self.assertEqual(result['details'], entry.get('details', ''))
        for details in [None, 5, 'x' * 241, 'bad\nvalue']:
            self.assertFalse(monitor.validate({**self.entry(), 'details': details}))

    def test_invalid_config(self):
        for update in [{'url': 'file:///secret'}, {'url': 'https://user:password@example.com/'}, {'timeout': True},
                       {'timeout': 0}, {'timeout': float('nan')}, {'timeout': 31}, {'enabled': 'yes'},
                       {'expected_status_codes': []}, {'expected_status_codes': [True]}, {'id': '../secret'}, {'name': ''}]:
            with self.subTest(update=update):
                self.assertFalse(monitor.validate({**self.entry(), **update}))
        self.assertTrue(monitor.validate(self.entry()))
        self.assertFalse(monitor.validate(None))

    def collect_text(self, value):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'servers.json'
            path.write_text(value)
            return monitor.collect(path)

    def test_malformed_empty_and_duplicates(self):
        for content in ['{bad json', '{}', 'null']:
            self.assertTrue(self.collect_text(content)['configuration_error'])
        self.assertEqual(self.collect_text('[]')['servers'], [])
        result = self.collect_text(json.dumps([self.entry(), self.entry()]))
        self.assertTrue(result['configuration_error'])
        self.assertEqual([s['status'] for s in result['servers']], ['unknown', 'unknown'])

    def test_isolation_disabled_and_public_allowlist(self):
        entries = [self.entry(), {'url': 'https://user:supersecret@private.internal/'},
                   {**self.entry(), 'id': 'disabled', 'enabled': False}]
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'servers.json'
            config.write_text(json.dumps(entries))
            output = Path(folder) / 'public'
            logs = io.StringIO()
            with contextlib.redirect_stdout(logs):
                monitor.build(config, output)
            result = json.loads((output / 'status.json').read_text())
            self.assertEqual(len(result['servers']), 2)
            self.assertEqual(result['servers'][0]['id'], 'test')
            self.assertEqual(result['servers'][1]['status'], 'unknown')
            self.assertEqual(set(p.name for p in output.iterdir()), {'index.html','style.css','app.js','status-model.js','status.json','.nojekyll'})
            public = (output / 'status.json').read_text() + logs.getvalue()
            for forbidden in ['supersecret', 'private.internal', '127.0.0.1', 'url', 'headers']:
                self.assertNotIn(forbidden, public)


if __name__ == '__main__':
    unittest.main()
