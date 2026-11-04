"""Offline negative-path checks for the D69 retained-data/schema boundary."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from scripts.tests.script_loader import load_script


m = load_script('sms_publisher_test', 'publish-local-sms-workspace.py')


def metadata(name):
    schema, table = name.split('.')
    return {'schema': schema, 'table': table, 'columns': [], 'indexes': [],
            'foreignKeys': [], 'checks': []}


class SmsPublicationTests(unittest.TestCase):
    def setUp(self):
        golden = {name: metadata(name) for name in sorted(m.NEW | {m.CHANGED})}
        for row in golden.values():
            row['columns'] = [{'name': 'Id', 'is_nullable': False}]
            row['indexes'] = [{'name': 'PK_' + row['table'], 'index_id': 1, 'is_unique': True}]
        old = deepcopy(golden[m.CHANGED])
        golden[m.CHANGED]['columns'].extend({'name': name, 'is_nullable': False}
            for name in ('LifetimeSeconds', 'ResendSeconds', 'MaxAttempts'))
        golden[m.CHANGED]['checks'] = [{'name': 'CK_Otp_MaxAttempts', 'definition': '[MaxAttempts] > 0'}]
        self.contract = {'metadata': list(golden.values())}
        names = [m.CHANGED] + sorted({s+'.__EFMigrationsHistory' for s,_ in m.MIGRATIONS}) + ['retained.Table'+str(n) for n in range(228)]
        self.before = {'tables':[{'schema':n.split('.')[0],'table':n.split('.')[1],'count':1,'sha256':'retained-hash'} for n in names],
            'metadata':[old if n==m.CHANGED else metadata(n) for n in names],
            'histories':[{'schema':'identity','MigrationId':'baseline'+str(n),'ProductVersion':'10.0.12'} for n in range(89)],
            'configuration':{'privateHash':'unchanged'}}
        self.after = deepcopy(self.before)
        self.after['metadata'] = [deepcopy(golden[m.CHANGED]) if row['schema']+'.'+row['table']==m.CHANGED else row for row in self.after['metadata']]
        for name in sorted(m.NEW):
            self.after['tables'].append({'schema':name.split('.')[0],'table':name.split('.')[1],'count':0,'sha256':'new-table-hash'})
            self.after['metadata'].append(deepcopy(golden[name]))
        self.after['histories'] += [{'schema':s,'MigrationId':name,'ProductVersion':'10.0.12'} for s,name in m.MIGRATIONS]
        self.bindings={'keyBindings':1,'routes':8,'enabledNewRoutes':0,'commands':0,'messages':0,'signals':0}

    def check(self):
        with patch.object(m.ops,'payload',return_value=self.bindings): return m.preserve(self.before,self.after,self.contract)

    def test_accepted_delta_retains_all_original_records_and_uses_only_portable_index_semantics(self):
        self.after['metadata'][-1]['indexes'][0]['index_id'] = 42
        self.assertEqual(self.check(),self.bindings)

    def test_old_data_change_or_missing_table_is_rejected(self):
        self.after['tables'][0]['sha256']='changed'
        with self.assertRaises(m.ops.PublishError): self.check()
        self.after['tables'].pop()
        with self.assertRaises(m.ops.PublishError): self.check()

    def test_unapproved_schema_or_history_change_is_rejected(self):
        self.after['metadata'][-1]['columns'][0]['is_nullable']=True
        with self.assertRaises(m.ops.PublishError): self.check()
        self.setUp(); self.after['histories'][-1]['MigrationId']='unapproved'
        with self.assertRaises(m.ops.PublishError): self.check()

    def test_live_key_binding_and_future_only_defaults_must_match(self):
        for field in ('keyBindings','enabledNewRoutes','messages','signals'):
            with self.subTest(field=field):
                initial=self.bindings[field]; self.bindings[field]=initial+1
                with self.assertRaises(m.ops.PublishError): self.check()
                self.bindings[field]=initial

    def test_private_configuration_change_is_rejected(self):
        self.after['configuration']['privateHash']='changed'
        with self.assertRaises(m.ops.PublishError): self.check()


if __name__ == '__main__': unittest.main()
