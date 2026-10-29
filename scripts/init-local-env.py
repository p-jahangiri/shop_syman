from pathlib import Path
import os,secrets
p=Path('.env')
if p.exists():
 print('Existing .env preserved')
else:
 values={'SQL_SA_PASSWORD':'Sayman!'+secrets.token_urlsafe(24),'AUTH_SIGNING_KEY':secrets.token_urlsafe(64),'BOOTSTRAP_ADMIN_PASSWORD':'Sayman!'+secrets.token_urlsafe(24)}
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:
  for key,value in values.items():f.write(f'{key}={value}\n')
 print('Created private local .env; values were not printed')
