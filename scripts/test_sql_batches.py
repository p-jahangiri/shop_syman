"""Offline parser/planner/evidence tests. Never launches dotnet, Docker or SQL."""
from collections import Counter
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import importlib.util
import signal
import xml.etree.ElementTree as ET


spec = importlib.util.spec_from_file_location('sql_batches', Path(__file__).with_name('test-sql-batches.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def discovery(names):
    return 'Test run for /compiled/Shop.SqlTests.dll\n' + runner.MARKER + '\n' + '\n'.join('    ' + name for name in names) + '\n'


def trx(path, names, outcomes=None):
    outcomes = outcomes or ['Passed'] * len(names)
    root = ET.Element('TestRun', xmlns='http://microsoft.com/schemas/VisualStudio/TeamTest/2010')
    summary = ET.SubElement(root, 'ResultSummary')
    counts = {'total': str(len(names)), 'executed': str(len(names)), 'passed': str(outcomes.count('Passed')),
              'failed': str(outcomes.count('Failed')), 'notExecuted': str(outcomes.count('NotExecuted'))}
    ET.SubElement(summary, 'Counters', counts)
    definitions, results = ET.SubElement(root, 'TestDefinitions'), ET.SubElement(root, 'Results')
    for index, (name, outcome) in enumerate(zip(names, outcomes)):
        method = runner.test_method(name)
        cls, method_name = method.rsplit('.', 1)
        test = ET.SubElement(definitions, 'UnitTest', {'id': f'test-{index}', 'name': name})
        ET.SubElement(test, 'TestMethod', {'className': cls, 'name': method_name})
        ET.SubElement(results, 'UnitTestResult', {'testId': f'test-{index}', 'executionId': f'run-{index}', 'testName': name, 'outcome': outcome})
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)


class DiscoveryTests(TestCase):
    def test_theory_values_do_not_change_class_or_method_identity(self):
        names = ['Shop.SqlTests.OneTests.Theory(argument: "a.b(c), d", expected: "x(y)")',
                 'Shop.SqlTests.Outer+InnerTests.Fact', 'Shop.SqlTests.OneTests.Theory(argument: "escaped \\\" (", expected: null)']
        self.assertEqual(runner.parse_discovery(discovery(names)), names)
        self.assertEqual(runner.test_method(names[0]), 'Shop.SqlTests.OneTests.Theory')
        self.assertEqual(runner.test_method(names[1]), 'Shop.SqlTests.Outer+InnerTests.Fact')

    def test_duplicate_truncated_display_names_remain_distinct_counter_entries(self):
        names = ['Shop.SqlTests.OneTests.Theory(value: "long"...)'] * 2
        self.assertEqual(Counter(runner.parse_discovery(discovery(names))), Counter({names[0]: 2}))

    def test_missing_marker_wrapped_rows_unknown_namespace_and_incomplete_theory_fail_closed(self):
        for output in ('no discovery', discovery([]), discovery(['Another.Tests.Case.Method']),
                       discovery(['Shop.SqlTests.OneTests.Method(value: "unterminated"']),
                       discovery(['Shop.SqlTests.OneTests.Method']) + '    continuation of theory\n'):
            with self.subTest(output=output), self.assertRaises(runner.EvidenceError):
                runner.parse_discovery(output)

    def test_batches_keep_complete_classes_and_use_exact_methods_for_all_theory_cases(self):
        names = ['Shop.SqlTests.A.Fact', 'Shop.SqlTests.A.Theory(value: 1)', 'Shop.SqlTests.A.Theory(value: 2)',
                 'Shop.SqlTests.ALong.Fact', 'Shop.SqlTests.B.ConcurrentTwoCommands', 'Shop.SqlTests.B.Fact']
        batches = runner.plan_batches(names, 3)
        self.assertEqual([batch['expectedCount'] for batch in batches], [3, 3])
        self.assertEqual(batches[0]['classes'], ['Shop.SqlTests.A'])
        self.assertEqual(batches[0]['filter'], 'FullyQualifiedName=Shop.SqlTests.A.Fact|FullyQualifiedName=Shop.SqlTests.A.Theory')
        self.assertNotIn('~', batches[0]['filter'])
        self.assertEqual(Counter(name for batch in batches for name in batch['names']), Counter(names))
        self.assertIn('ConcurrentTwoCommands', batches[1]['filter'])

    def test_large_classes_are_reported_whole_instead_of_splitting_a_fixture(self):
        names = [f'Shop.SqlTests.Large.Theory(value: {number})' for number in range(5)]
        batches = runner.plan_batches(names, 2)
        self.assertEqual(len(batches), 1)
        self.assertTrue(batches[0]['oversizedWholeClass'])
        self.assertEqual(batches[0]['expectedCount'], 5)


class TrxTests(TestCase):
    def test_counter_equality_allows_duplicate_labels_only_with_distinct_execution_ids(self):
        names = ['Shop.SqlTests.A.Theory(value: "truncated"...)'] * 2
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'result.trx'
            trx(path, names)
            value = runner.parse_trx(path)
            runner.validate_trx(value, names)
            value['executionIds'][1] = value['executionIds'][0]
            with self.assertRaises(runner.EvidenceError):
                runner.validate_trx(value, names)

    def test_missing_extra_failed_and_skipped_cases_are_not_accepted(self):
        names = ['Shop.SqlTests.A.One', 'Shop.SqlTests.A.Two']
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'result.trx'
            for actual, outcomes in ((names[:1], None), (names + ['Shop.SqlTests.B.Other'], None),
                                     (names, ['Passed', 'Failed']), (names, ['Passed', 'NotExecuted'])):
                trx(path, actual, outcomes)
                with self.subTest(actual=actual, outcomes=outcomes), self.assertRaises(runner.EvidenceError):
                    runner.validate_trx(runner.parse_trx(path), names)

    def test_passing_totals_cannot_hide_wrong_names_methods_or_warning_counters(self):
        names = ['Shop.SqlTests.A.One', 'Shop.SqlTests.A.Two']
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'result.trx'
            trx(path, names)
            original = runner.parse_trx(path)
            for mutation in ('label', 'method', 'warning'):
                value = deepcopy(original)
                if mutation == 'label':
                    value['names'][1] = 'Shop.SqlTests.A.Other'
                elif mutation == 'method':
                    value['methods']['test-1'] = 'Shop.SqlTests.Other.Two'
                else:
                    value['counters']['warning'] = 1
                with self.subTest(mutation=mutation), self.assertRaises(runner.EvidenceError):
                    runner.validate_trx(value, names)


class ResumeTests(TestCase):
    def fixture(self, directory):
        names = ['Shop.SqlTests.A.One', 'Shop.SqlTests.B.Two']
        plan = {'runId': 'offline', 'batches': runner.plan_batches(names, 1)}
        root = Path(directory)
        plan_path = root / 'plan.json'
        runner.write(plan_path, plan)
        result = root / 'first.trx'
        trx(result, names[:1])
        log, command, clean = root / 'first.log', root / 'command.json', root / 'cleanup.log'
        log.write_text('synthetic console result')
        runner.write(command, {'status': 'completed', 'returnCode': 0, 'pid': 43210,
                              'processGroupId': 43210, 'newSession': True,
                              'termination': {'processGroupId': 43210, 'processGroupEmpty': True, 'signals': []}})
        clean.write_text('SQL cleanup verified: zero SaymanTest_* databases remain. No data was deleted.')
        batch = plan['batches'][0]
        entry = {**batch, 'passed': 1, 'failed': 0, 'skipped': 0, 'sourceUnchanged': True, 'module14Unchanged': True,
                 'trx': result.name, 'trxSha256': runner.sha(result), 'log': log.name, 'logSha256': runner.sha(log),
                 'command': command.name, 'commandSha256': runner.sha(command),
                 'cleanup': {'path': clean.name, 'sha256': runner.sha(clean), 'command': command.name,
                             'commandSha256': runner.sha(command), 'returnCode': 0, 'status': 'completed', 'disposableDatabasesRemaining': 0}}
        proof = {'runId': 'offline', 'planSha256': runner.sha(plan_path), 'batches': [entry]}
        return plan, proof, plan_path, result

    def test_resume_keeps_previous_verified_coverage_and_rechecks_original_trx(self):
        with TemporaryDirectory() as directory, patch.object(runner, 'ROOT', Path(directory).resolve()):
            plan, proof, path, result = self.fixture(directory)
            self.assertEqual(len(runner.verified_prefix(plan, proof, path)), 1)
            result.write_text('changed evidence')
            with self.assertRaises(runner.EvidenceError):
                runner.verified_prefix(plan, proof, path)

    def test_resume_cannot_skip_a_batch_or_accept_a_fake_zero_cleanup(self):
        with TemporaryDirectory() as directory, patch.object(runner, 'ROOT', Path(directory).resolve()):
            plan, proof, path, _ = self.fixture(directory)
            modified = deepcopy(proof)
            modified['batches'][0]['index'] = 2
            with self.assertRaises(runner.EvidenceError):
                runner.verified_prefix(plan, modified, path)
            proof['batches'][0]['cleanup']['returnCode'] = 1
            with self.assertRaises(runner.EvidenceError):
                runner.verified_prefix(plan, proof, path)

    def test_resume_refuses_parent_only_completion_without_process_group_evidence(self):
        with TemporaryDirectory() as directory, patch.object(runner, 'ROOT', Path(directory).resolve()):
            plan, proof, path, _ = self.fixture(directory)
            entry = proof['batches'][0]
            command = Path(directory) / entry['command']
            runner.write(command, {'status': 'completed', 'returnCode': 0})
            entry['commandSha256'] = runner.sha(command)
            with self.assertRaises(runner.EvidenceError):
                runner.verified_prefix(plan, proof, path)


class ProcessGroupTests(TestCase):
    class Process:
        pid = 43210
        returncode = 0

        def poll(self):
            return self.returncode

        def wait(self, timeout):
            return self.returncode

    def group(self, stubborn=False):
        state = {'alive': True, 'time': 0.0, 'signals': []}

        def killpg(pgid, sig):
            self.assertEqual(pgid, self.Process.pid)
            if not state['alive']:
                raise ProcessLookupError()
            if sig:
                state['signals'].append(sig)
                if sig == signal.SIGKILL and not stubborn:
                    state['alive'] = False

        def sleep(seconds):
            state['time'] += seconds

        return state, killpg, sleep

    def test_parent_exit_does_not_hide_a_child_that_needs_sigkill_in_the_same_owned_group(self):
        state, killpg, sleep = self.group()
        with patch.object(runner.os, 'killpg', killpg), patch.object(runner.time, 'monotonic', lambda: state['time']), patch.object(runner.time, 'sleep', sleep):
            result = runner.stop_owned(self.Process(), grace_seconds=0.2, kill_grace_seconds=0.2)
        self.assertTrue(result['parentAlreadyExited'])
        self.assertTrue(result['processGroupEmpty'])
        self.assertEqual(state['signals'], [signal.SIGINT, signal.SIGKILL])
        self.assertEqual(result['signals'], ['SIGINT', 'SIGKILL'])

    def test_an_empty_group_is_verified_without_signalling_any_process(self):
        with patch.object(runner.os, 'killpg', side_effect=ProcessLookupError()) as killpg:
            result = runner.stop_owned(self.Process())
        self.assertTrue(result['processGroupEmpty'])
        self.assertEqual(result['signals'], [])
        self.assertTrue(all(call.args[1] == 0 for call in killpg.call_args_list))

    def test_group_that_survives_sigkill_never_claims_cleanup_is_safe(self):
        state, killpg, sleep = self.group(stubborn=True)
        with patch.object(runner.os, 'killpg', killpg), patch.object(runner.time, 'monotonic', lambda: state['time']), patch.object(runner.time, 'sleep', sleep):
            result = runner.stop_owned(self.Process(), grace_seconds=0.2, kill_grace_seconds=0.2)
        self.assertFalse(result['processGroupEmpty'])
        self.assertEqual(state['signals'], [signal.SIGINT, signal.SIGKILL])

    def test_completed_wrapper_with_live_descendant_is_recorded_and_not_accepted_as_clean_completion(self):
        state, killpg, sleep = self.group()
        with TemporaryDirectory() as directory, patch.object(runner, 'ROOT', Path(directory).resolve()), patch.object(runner.subprocess, 'Popen', return_value=self.Process()) as launch, patch.object(runner.os, 'killpg', killpg), patch.object(runner.time, 'monotonic', lambda: state['time']), patch.object(runner.time, 'sleep', sleep):
            path = Path(directory).resolve() / 'command'
            result = runner.command(['offline-fake-no-process'], path, 30)
            record = runner.read(path / 'command.json')
        self.assertTrue(launch.call_args.kwargs['start_new_session'])
        self.assertEqual(result['status'], 'orphaned-descendants-stopped')
        self.assertTrue(record['termination']['processGroupEmpty'])
        self.assertEqual(record['termination']['processGroupId'], self.Process.pid)

if __name__ == '__main__':
    main()
