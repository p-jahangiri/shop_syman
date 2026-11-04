"""Offline rejection checks for D57 publication evidence; no application or SQL runs."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import hashlib
import importlib.util
import json


spec = importlib.util.spec_from_file_location(
    'fulfillment_evidence_publication', Path(__file__).with_name('publish-local-fulfillment.py'))
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CommandEvidenceTests(TestCase):
    def fixture(self, directory):
        root = Path(directory)
        log, command_path = root / 'batch.log', root / 'command.json'
        log.write_text('Synthetic completed SQL batch log.\n')
        command = {'status': 'completed', 'returnCode': 0, 'cwd': str(publication.ROOT),
                   'logSha256': sha(log), 'argv': ['synthetic-python', 'synthetic-test-runner'],
                   'pid': 12345, 'processGroupId': 12345, 'newSession': True,
                   'termination': {'processGroupId': 12345, 'processGroupEmpty': True, 'signals': []}}
        command_path.write_text(json.dumps(command))
        record = {'log': 'offline/batch.log', 'logSha256': sha(log),
                  'command': 'offline/command.json', 'commandSha256': sha(command_path)}
        return log, command_path, command, record

    def test_unchanged_successful_command_and_log_are_accepted(self):
        with TemporaryDirectory() as directory:
            log, command_path, command, record = self.fixture(directory)
            with patch.object(publication.ops, 'relative_path', side_effect=lambda value, _: Path(directory) / Path(value).name):
                actual, files = publication.verified_command(record)
            self.assertEqual(actual, command)
            self.assertEqual(files, [log, command_path])

    def test_a_rehashed_nonzero_command_cannot_borrow_a_passing_log(self):
        with TemporaryDirectory() as directory:
            _, command_path, command, record = self.fixture(directory)
            command['returnCode'] = 1
            command_path.write_text(json.dumps(command))
            record['commandSha256'] = sha(command_path)
            with patch.object(publication.ops, 'relative_path', side_effect=lambda value, _: Path(directory) / Path(value).name):
                with self.assertRaisesRegex(publication.ops.PublishError, 'did not finish successfully'):
                    publication.verified_command(record)

    def test_successful_parent_cannot_hide_live_or_force_stopped_descendants(self):
        for termination in [
            {'processGroupId': 12345, 'processGroupEmpty': False, 'signals': []},
            {'processGroupId': 12345, 'processGroupEmpty': True, 'signals': ['SIGKILL']},
        ]:
            with self.subTest(termination=termination), TemporaryDirectory() as directory:
                _, command_path, command, record = self.fixture(directory)
                command['termination'] = termination
                command_path.write_text(json.dumps(command))
                record['commandSha256'] = sha(command_path)
                with patch.object(publication.ops, 'relative_path', side_effect=lambda value, _: Path(directory) / Path(value).name):
                    with self.assertRaises(publication.ops.PublishError):
                        publication.verified_command(record)

    def test_changed_log_is_rejected_even_when_command_json_still_says_success(self):
        with TemporaryDirectory() as directory:
            log, _, _, record = self.fixture(directory)
            log.write_text('Different or stale evidence.\n')
            with patch.object(publication.ops, 'relative_path', side_effect=lambda value, _: Path(directory) / Path(value).name):
                with self.assertRaisesRegex(publication.ops.PublishError, 'command or log changed'):
                    publication.verified_command(record)


class DiscoveryAndPlanEvidenceTests(TestCase):
    def prefix(self, directory, changed_discovery=False, short_discovery=False):
        # Reach the discovery/plan boundary with synthetic earlier evidence.
        # No fixture represents a complete accepted release, and acceptance
        # must fail before any candidate DLL or runtime can be inspected.
        root = Path(directory)
        names = [f'Shop.SqlTests.SyntheticTests.Case(value: {number})' for number in range(913)]
        if short_discovery:
            names = names[:1]
        actual_names = list(names)
        if changed_discovery:
            actual_names[-1] = 'Shop.SqlTests.SyntheticTests.UnexpectedCase'
        discovery_path = root / 'discovery.log'
        discovery_path.write_text('The following Tests are available:\n' + ''.join('    ' + name + '\n' for name in actual_names))
        proof_path, plan_path = root / 'proof.json', root / 'missing-plan.json'
        owned = {name: 'synthetic-source-sha' for name in publication.ALLOWED}
        discovery = {'path': 'offline/discovery.log', 'sha256': sha(discovery_path),
                     'fullSuite': True, 'filterApplied': False, 'names': names}
        coverage = {
            'schemaVersion': 1, 'acceptanceMode': 'complete-class-batches', 'status': 'passed',
            'fullSuite': True, 'fullCoverage': True, 'exactDiscoveryExecutionMatch': True,
            'allSelectedClassCasesIncluded': True, 'total': 913, 'expectedCount': 913,
            'executedCount': 913, 'passed': 913, 'failed': 0, 'skipped': 0,
            'disposableDatabasesRemaining': 0, 'sourceUnchanged': True, 'module14Unchanged': True,
            'discovery': discovery, 'plan': 'offline/missing-plan.json', 'planSha256': 'missing-plan-sha',
        }
        evidence = {'ownedSourceSha256': owned, 'tests': {
            'fullUnit': {'path': str(publication.UNIT.relative_to(publication.ROOT)),
                         'passed': publication.UNIT_EXPECTED, 'failed': 0, 'skipped': 0, 'sha256': 'unit-sha'},
            'fullSql': {'path': 'offline/proof.json', 'sha256': 'proof-sha',
                        'passed': 913, 'failed': 0, 'skipped': 0},
        }}
        documents = {publication.EVIDENCE: evidence, publication.BASELINE: {'source': {}}, proof_path: coverage}
        original_sha = publication.ops.sha

        def artifact_sha(path):
            if path == publication.UNIT:
                return 'unit-sha'
            if path == proof_path:
                return 'proof-sha'
            return original_sha(path)

        stack = ExitStack()
        stack.enter_context(patch.object(publication, 'SQL_EXPECTED', 913))
        stack.enter_context(patch.object(publication, 'sources', return_value=owned))
        stack.enter_context(patch.object(publication.ops, 'read', side_effect=lambda path: deepcopy(documents[path])))
        stack.enter_context(patch.object(publication.ops, 'sha', side_effect=artifact_sha))
        stack.enter_context(patch.object(publication.ops, 'relative_path', side_effect=lambda value, _: root / Path(value).name))
        stack.enter_context(patch.object(publication.ops, 'accepted_trx', return_value=[]))
        # A new dependency must not accidentally turn an offline check into an
        # application, filesystem publication, network or SQL operation.
        stack.enter_context(patch.object(publication.ops.subprocess, 'Popen', side_effect=AssertionError('Runtime launch forbidden')))
        stack.enter_context(patch.object(publication.ops.subprocess, 'run', side_effect=AssertionError('Command execution forbidden')))
        stack.enter_context(patch.object(publication.ops.HTTP, 'open', side_effect=AssertionError('HTTP forbidden')))
        stack.enter_context(patch.object(publication.ops, 'payload', side_effect=AssertionError('SQL forbidden')))
        return stack, plan_path

    def test_rehashed_raw_discovery_cannot_change_the_accepted_case_list(self):
        with TemporaryDirectory() as directory:
            stack, _ = self.prefix(directory, changed_discovery=True)
            with stack, self.assertRaisesRegex(publication.ops.PublishError, 'Raw SQL discovery differs'):
                publication.acceptance()

    def test_missing_original_plan_is_rejected_before_candidate_or_runtime_access(self):
        with TemporaryDirectory() as directory:
            stack, plan_path = self.prefix(directory)
            with stack, self.assertRaises(FileNotFoundError):
                publication.acceptance()
            self.assertFalse(plan_path.exists())

    def test_full_totals_cannot_hide_a_short_actual_discovery(self):
        with TemporaryDirectory() as directory:
            stack, _ = self.prefix(directory, short_discovery=True)
            with stack, self.assertRaisesRegex(publication.ops.PublishError, 'Fresh complete SQL discovery changed'):
                publication.acceptance()


if __name__ == '__main__':
    main(verbosity=2)
