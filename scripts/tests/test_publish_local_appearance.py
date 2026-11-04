"""Offline fault injection for the D55 local publisher. No subprocess, HTTP or SQL runs."""
from contextlib import ExitStack
from copy import deepcopy
from unittest import TestCase, main
from unittest.mock import patch
import hashlib
import json

from scripts.tests.script_loader import load_script


publication = load_script('appearance_publication', 'publish-local-appearance.py')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class FakeProcess:
    def __init__(self, pid):
        self.pid = pid
        self.running = True

    def poll(self):
        return None if self.running else 0

    def terminate(self):
        self.running = False

    def wait(self, timeout):
        if self.running:
            raise AssertionError('A fake process must stop before waiting.')


class PublisherHarness:
    def __init__(self, fault=None):
        self.fault = fault
        self.old = {'runtimeDirectory': 'tmp/api-runtime-original', 'apiPid': 100}
        self.original_aggregate = {'componentReleaseEvidence': {'api': 'old-release.json'}}
        self.unrelated_aggregate = {'componentReleaseEvidence': {'storefront': 'other-release.json'}}
        self.source = {'source': 'fixed'}
        self.modules = {'assembly': 'fixed'}
        self.tests = {'tests': 'fixed'}
        self.package = {
            'runId': 'offline-fault-test', 'modules': self.modules, 'tests': self.tests,
            'source': self.source, 'previous': self.old, 'previousSha': digest(self.old),
            'aggregate': self.original_aggregate, 'aggregateSha': digest(self.original_aggregate),
            'process': {'pid': 100}, 'configuration': {}, 'frontends': {}, 'databaseShape': {},
            'runtimeDirectory': 'tmp/api-runtime-new', 'artifactManifest': 'manifest.json',
            'artifactManifestSha256': 'manifest-sha',
        }
        self.release = publication.CHECKS / 'd55-api-offline-fault-test-main-release.json'
        self.store = {
            publication.CURRENT: deepcopy(self.old),
            publication.AGGREGATE: deepcopy(self.original_aggregate),
            publication.PREPARED: deepcopy(self.package),
        }
        self.processes = [FakeProcess(100)]
        self.listener_pid = 100
        self.aggregate_writes = 0
        self.failed_once = False

    def read(self, path):
        return deepcopy(self.store[path])

    def sha(self, path):
        if path == publication.AGGREGATE and self.fault == 'foreign-before-commit' and self.release in self.store:
            self.store[path] = deepcopy(self.unrelated_aggregate)
        return digest(self.store[path])

    def write(self, path, value):
        if path == self.release and self.fault == 'release' and not self.failed_once:
            self.failed_once = True
            raise OSError('Injected release write failure')
        if path == publication.AGGREGATE:
            self.aggregate_writes += 1
            if self.fault in {'aggregate-before', 'aggregate-after', 'aggregate-foreign'} and not self.failed_once:
                self.failed_once = True
                if self.fault == 'aggregate-after':
                    self.store[path] = deepcopy(value)
                elif self.fault == 'aggregate-foreign':
                    self.store[path] = deepcopy(self.unrelated_aggregate)
                raise OSError('Injected aggregate write failure')
        self.store[path] = deepcopy(value)

    def stop(self, state):
        if state['apiPid'] != self.listener_pid:
            raise AssertionError('The publisher attempted to stop an unowned process.')
        next(p for p in self.processes if p.pid == self.listener_pid).terminate()
        self.listener_pid = None

    def start(self, log):
        if self.listener_pid is not None:
            raise AssertionError('The publisher attempted to start a second API.')
        process = FakeProcess(100 + len(self.processes))
        self.processes.append(process)
        self.listener_pid = process.pid
        self.store[publication.CURRENT]['apiPid'] = process.pid
        return process

    def require(self, condition, message):
        if not condition:
            raise publication.ops.PublishError(message)

    def patches(self):
        stack = ExitStack()
        stack.enter_context(patch.object(publication, 'acceptance', return_value=(self.modules, self.tests)))
        stack.enter_context(patch.object(publication, 'sources', return_value=self.source))
        operations = {
            'read': self.read, 'sha': self.sha, 'write': self.write, 'require': self.require,
            'process_fingerprint': lambda state: {'pid': state['apiPid']},
            'private_configuration': lambda: {}, 'frontend_descriptors': lambda: {},
            'database_shape': lambda: {}, 'check_runtime': lambda state: None,
            'stop_process': self.stop, 'start_api': self.start,
            'wait_ready': lambda process: {'ready': True},
            'request': lambda *args, **kwargs: ({'status': 200}, b''),
            'listener': lambda: self.listener_pid,
        }
        for name, replacement in operations.items():
            stack.enter_context(patch.object(publication.ops, name, replacement))
        # Fail closed if a new dependency accidentally escapes the fake boundary.
        stack.enter_context(patch.object(publication.ops.subprocess, 'Popen', side_effect=AssertionError('Real process forbidden')))
        stack.enter_context(patch.object(publication.ops.subprocess, 'run', side_effect=AssertionError('Real command forbidden')))
        stack.enter_context(patch.object(publication.ops.HTTP, 'open', side_effect=AssertionError('Real HTTP forbidden')))
        stack.enter_context(patch.object(publication.ops, 'payload', side_effect=AssertionError('Real SQL forbidden')))
        return stack


class AppearancePublicationTests(TestCase):
    def test_release_write_failure_clears_success_and_recovers_original_api(self):
        harness = PublisherHarness('release')
        with harness.patches(), self.assertRaises(OSError):
            publication.apply()
        self.assert_recovered(harness)

    def test_aggregate_failure_before_write_leaves_original_aggregate(self):
        harness = PublisherHarness('aggregate-before')
        with harness.patches(), self.assertRaises(OSError):
            publication.apply()
        self.assert_recovered(harness)
        self.assertEqual(harness.aggregate_writes, 1)

    def test_aggregate_failure_after_replace_restores_only_own_record(self):
        harness = PublisherHarness('aggregate-after')
        with harness.patches(), self.assertRaises(OSError):
            publication.apply()
        self.assert_recovered(harness)
        self.assertEqual(harness.aggregate_writes, 2)

    def test_unrelated_aggregate_is_preserved_and_incomplete_rollback_is_reported(self):
        for fault in ['aggregate-foreign', 'foreign-before-commit']:
            with self.subTest(fault=fault):
                harness = PublisherHarness(fault)
                with harness.patches(), self.assertRaises(publication.ops.PublishError):
                    publication.apply()
                self.assertEqual(harness.store[publication.AGGREGATE], harness.unrelated_aggregate)
                report = harness.store[harness.release]
                self.assertFalse(report['passed'])
                self.assertTrue(report['apiRolledBack'])
                self.assertTrue(report['rollbackIncomplete'])
                self.assertNotIn('rolledBack', report)
                self.assertEqual(len(harness.processes), 3)
                self.assertEqual(harness.aggregate_writes, int(fault == 'aggregate-foreign'))

    def test_broken_or_closed_stdout_cannot_undo_a_committed_release(self):
        for error in [BrokenPipeError('pipe closed'), OSError('output failed'), ValueError('stream closed')]:
            with self.subTest(error=type(error).__name__):
                harness = PublisherHarness()
                with harness.patches(), patch('builtins.print', side_effect=error):
                    publication.apply()
                report = harness.store[harness.release]
                self.assertTrue(report['passed'])
                self.assertNotIn('rolledBack', report)
                self.assertEqual(len(harness.processes), 2)
                self.assertEqual(harness.listener_pid, report['apiPid'])
                self.assertEqual(harness.store[publication.CURRENT]['runtimeDirectory'], 'tmp/api-runtime-new')
                self.assertEqual(harness.store[publication.AGGREGATE]['componentReleaseEvidence']['api'],
                                 str(harness.release.relative_to(publication.ROOT)))

    def assert_recovered(self, harness):
        report = harness.store[harness.release]
        self.assertFalse(report['passed'])
        self.assertTrue(report['rolledBack'])
        self.assertTrue(report['aggregateRestored'])
        self.assertEqual(harness.store[publication.AGGREGATE], harness.original_aggregate)
        self.assertEqual(harness.store[publication.CURRENT]['runtimeDirectory'], harness.old['runtimeDirectory'])
        self.assertEqual(harness.listener_pid, report['rollbackPid'])
        for key in ['apiPid', 'runtimeDirectory', 'httpChecks', 'module14Parity', 'schema85Tables222',
                    'configAndKeysPreserved', 'frontendDescriptorsUnchanged']:
            self.assertNotIn(key, report)
        self.assertEqual(len(harness.processes), 3)


if __name__ == '__main__':
    main(verbosity=2)
