Sayman Store
A bilingual Persian–English storefront with an independent admin panel and a modular API connected to SQL Server. The current status, roadmap, and owner decisions are the reference for continuing the project.

Running Locally
Per D44, Sayman is a local monorepo with a database named Sayman.

Component	Address
Storefront	Persian · English
Admin panel	Port 3173
API health & SQL connection	Port 5080
SQL Server	127.0.0.1:11433 · Sayman
Setting Up a Fresh Environment
Requires Node.js 22.18 or newer, .NET 10 SDK, Python 3, and Docker Compose.

bash
npm ci
npm ci --prefix tools/lint --ignore-scripts
python3 scripts/init-local-env.py
docker compose --profile backend up -d --wait sqlserver
dotnet restore backend/src/Shop.Api --locked-mode
dotnet build backend/src/Shop.Api --no-restore --disable-build-servers -m:1
python3 scripts/backend-local.py --seed-dev
--seed-dev prepares a fresh database in Development. The .env file is created for the local environment and contains sensitive information. In a fresh environment, the initial login is performed with the admin account and a private initial password. Subsequent logins use the current password and the Authenticator of that same account.

Run the API, storefront, and admin panel in three terminals on the ports listed in the table above.

bash
npm run dev:api
SHOP_DATA_MODE=api SHOP_API_URL=http://127.0.0.1:5080 SHOP_PUBLIC_URL=http://127.0.0.1:3000 npm run dev
npm run build:admin
HOSTNAME=127.0.0.1 PORT=3173 ADMIN_API_URL=http://127.0.0.1:5080 ADMIN_PUBLIC_URL=http://127.0.0.1:3173 node apps/admin/server.mjs
For environments that have a registered local release, the scripts/serve-main-* scripts verify the specifications and hashes of the selected bundle and bring that same bundle back up. To build the frontends offline and replace the active release, use scripts/local/build-local-frontends.py and the prepare and apply steps in scripts/publish-local-frontends.py.

Repository Structure
Path	Responsibility
apps/storefront	Next.js storefront routes, UI, and BFF
apps/admin	React/Vite admin panel and administrative API proxy
packages/design-tokens	Shared design tokens
packages/web-shared	HTTP contracts, UI components, and shared utilities
backend/src/Shop.Api	Application composition root, routes, and access policies
backend/src/Shop.Modules.*	Domain logic, contracts, data, and migrations for each module
backend/tests	Unit tests and integration tests with SQL Server
scripts/tests	Tests for operations and publishing tools
backend/Seed and database	Explicit development and service data, and SQL Server outputs
scripts, deploy, and .github/workflows	Development and operations tooling, packaging, and CI
tools	Quality checks and explicit development data tools
data and design	Data resources and design/brand reference files
tmp and artifacts	Local run and rollback bundles, evidence, and check outputs
docs and skills/dynamic-shop	Requirements, contracts, operations guide, and project rules
Amounts are stored as integer rials in the domain and SQL, and as decimal strings in JSON. Each module owns its own data, and exchange between modules happens through well-defined contracts. Architecture · API Contract

Admin panel pages live in apps/admin/src/pages, shared components in apps/admin/src/components, and admin panel contracts in apps/admin/src/api/contracts. The storefront groups each domain's components in components and its logic in lib. Frontend tests are in each app's tests folder. Full folder map

Each frontend is built from its own source and the explicit packages packages/web-shared and packages/design-tokens. For a separate output, use python3 deploy/package-production.py --component admin --output <new-directory>. The --component value for other bundles is storefront, api, or database. Deployment guide · Database · Scripts · Development tools

Checking Changes
bash
npm run lint
npm run format:check
npm run typecheck
npm run typecheck:admin
npm test
npm run test:admin-contract
npm run test:admin-server
python3 -m unittest discover -s scripts
dotnet test backend/tests/Shop.Tests --disable-build-servers -m:1
For SQL tests, first prepare the test project with dotnet restore backend/tests/Shop.SqlTests --locked-mode, then run python3 scripts/test-sql-local.py with SQL Server running. The test uses temporary SaymanTest_* databases and cleans them up at the end. Code quality guide

To review locally removable outputs, first run python3 scripts/local/cleanup-local-artifacts.py without options. After reviewing the list, --apply enforces the same retention policy. tmp contains both build outputs and active bundles, rollback versions, and local keys. Perform cleanup with the project's tooling.

