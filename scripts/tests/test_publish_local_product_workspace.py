import copy
import unittest

from scripts.tests.script_loader import load_script

m = load_script('product_workspace_publisher', 'publish-local-product-workspace.py')


def metadata(name):
 schema,table=name.split('.',1);return {'schema':schema,'table':table,'columns':[{'name':'Id','column_id':1,'is_nullable':False}],'indexes':[],'foreignKeys':[],'checks':[]}
def fixture():
 names=['catalog.Products','catalog.ProductMedia','catalog.__EFMigrationsHistory']+['existing.Table'+str(i)for i in range(237)]
 rows=[{'schema':name.split('.')[0],'table':name.split('.')[1],'count':1,'sha256':'a'*64}for name in names]
 before={'tables':rows,'histories':[{'schema':'catalog','MigrationId':'old'+str(i),'ProductVersion':'10.0.12'}for i in range(92)],'configuration':{'hash':'same'},'metadata':[metadata(name)for name in names]}
 after=copy.deepcopy(before)
 for name in sorted(m.NEW):
  after['tables'].append({'schema':'catalog','table':name.split('.')[1],'count':0,'sha256':'b'*64});after['metadata'].append(metadata(name))
 after['histories'].append({'schema':m.MIGRATION[0],'MigrationId':m.MIGRATION[1],'ProductVersion':m.MIGRATION[2]})
 for row in after['metadata']:
  name=row['schema']+'.'+row['table']
  if name in m.CHANGED:
   row['columns'].extend({'name':column,'column_id':2,'is_nullable':True}for column in sorted(m.CHANGED[name]))
 contract={'metadata':copy.deepcopy(after['metadata'])}
 return before,after,contract
class ProductWorkspacePublisherTests(unittest.TestCase):
 def test_only_the_reviewed_nullable_columns_and_four_empty_tables_are_accepted(self):
  before,after,contract=fixture();self.assertTrue(m.preserve(before,after,contract)['old240TablesPreserved'])
 def test_an_old_value_or_rowversion_change_is_rejected(self):
  before,after,contract=fixture();after['tables'][0]['sha256']='changed'
  with self.assertRaises(Exception):m.preserve(before,after,contract)
 def test_migration_backfill_into_a_new_feature_table_is_rejected(self):
  before,after,contract=fixture();after['tables'][-1]['count']=1
  with self.assertRaises(Exception):m.preserve(before,after,contract)
 def test_changing_an_unrelated_table_or_new_column_type_is_rejected(self):
  for unrelated in (True,False):
   before,after,contract=fixture()
   if unrelated:after['metadata'][4]['columns'][0]['is_nullable']=True
   else:after['metadata'][0]['columns'][-1]['is_nullable']=False
   with self.assertRaises(Exception):m.preserve(before,after,contract)
if __name__=='__main__':unittest.main()
