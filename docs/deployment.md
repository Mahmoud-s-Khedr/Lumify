# Production deployment

The repository contains a production Compose stack, Nginx templates, health/readiness checks, and
a PostgreSQL backup command. Actual deployment requires a VPS, DNS name, TLS certificate, and the
external Resend/R2 credentials.

## 1. Prepare the host

Install Docker Engine with the Compose plugin, Nginx, Certbot, the Certbot Nginx integration, and
`envsubst` (the `gettext-base` package on Debian/Ubuntu). Allow inbound TCP ports 22, 80, and 443
only. PostgreSQL is intentionally not published by the production Compose stack, and the API is
bound only to `127.0.0.1:3000` for host Nginx.

Clone the repository into a directory owned by the deployment user. Create the production
environment file and restrict its permissions:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every placeholder. Use different random JWT secrets, a long random PostgreSQL password,
the URL-encoded version of that password in `DATABASE_URL`, the exact frontend origin in
`CORS_ORIGIN`, and production Resend/R2 credentials. Keep the R2 bucket private and configure its
CORS policy for the frontend's direct signed uploads.

Validate the resolved Compose configuration before starting it:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail http://127.0.0.1:3000/ready
```

The API container applies committed Prisma migrations before starting. A failed readiness check
means either the API process or its PostgreSQL connection is unavailable.

## 2. Configure DNS and HTTPS

Point the API DNS record at the VPS. Replace every `api.example.com` occurrence in
`deploy/nginx/lumify.bootstrap.conf` and `deploy/nginx/lumify.conf.template` with the real hostname.

Install the HTTP bootstrap configuration first so Certbot can complete its challenge:

```bash
sudo cp deploy/nginx/lumify.bootstrap.conf /etc/nginx/sites-available/lumify
sudo ln -s /etc/nginx/sites-available/lumify /etc/nginx/sites-enabled/lumify
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --nginx -d api.example.com
```

Then render the HTTPS configuration using the Nginx rate-limit values in `.env.production`, install
it, verify it, and reload Nginx:

```bash
./deploy/render-nginx-config.sh .env.production | sudo tee /etc/nginx/sites-available/lumify >/dev/null
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://api.example.com/ready
```

The production template terminates TLS, redirects HTTP, forwards the trusted proxy headers,
limits request bursts, and caps proxied request bodies. `NGINX_RATE_LIMIT` accepts Nginx values
such as `20r/s` or `1200r/m`; `NGINX_RATE_LIMIT_BURST` is the immediate per-IP burst allowance.
The renderer sets Nginx's rate-limit response to `429`. After changing either value, render and
reload Nginx again. Uploaded assets do not pass through Nginx;
clients upload them directly to R2 with short-lived signed URLs.

It forwards WebSocket upgrade headers and uses a one-hour read timeout for Socket.IO communities.
This release supports one API instance. Before horizontally scaling, add a Socket.IO Redis adapter
or equivalent shared pub/sub so room events are delivered across API instances.

## 3. Configure backups

Choose a backup directory outside the repository, run one backup, and verify the resulting gzip
archive:

```bash
BACKUP_DIR=/var/backups/lumify ./deploy/backup-postgres.sh
gzip --test /var/backups/lumify/lumify-*.sql.gz
```

The script creates a private compressed `pg_dump` and removes matching backups older than 14 days.
Override this with `BACKUP_RETENTION_DAYS`. Schedule it with the deployment user's cron, for
example at 02:15 UTC:

```cron
15 2 * * * cd /srv/lumify && BACKUP_DIR=/var/backups/lumify ./deploy/backup-postgres.sh >> /var/log/lumify-backup.log 2>&1
```

Copy backups to separate storage; a backup on the same VPS does not protect against disk or host
loss. Test restoration regularly in a disposable database:

```bash
gzip --decompress --stdout /var/backups/lumify/lumify-TIMESTAMP.sql.gz \
  | docker compose --env-file .env.production -f docker-compose.production.yml exec -T db \
      sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

The example dump contains `--clean`, so restoration replaces objects in its target database. Use a
disposable database for routine restore drills and take a fresh backup before any production
restore.

## 4. Redeploy and rollback

For a normal redeploy:

```bash
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail https://api.example.com/ready
```

Before database-changing releases, take a backup. Application rollback means checking out the
previous known-good revision and rebuilding; database migrations need an explicit forward repair
or a tested backup restore because Prisma production migrations are not automatically reversed.

## Certificate issuance job

Set `CERTIFICATE_JOB_SECRET` to a distinct random value (at least 32 characters) and
`PUBLIC_BACKEND_URL` to the public API origin. The latter is embedded in certificate QR codes as
the public verification URL. After deploying, an administrator must upload, inspect, and activate
a fillable PDF through the certificate-template endpoints before certificates can be issued.

Run the protected issuance endpoint once a day after midnight UTC from the VPS. Keep the secret in
the protected production environment file rather than putting it literally in the crontab:

```cron
5 0 * * * cd /srv/lumify && set -a && . ./.env.production && set +a && curl --fail --silent --show-error -X POST -H "x-certificate-job-secret: $CERTIFICATE_JOB_SECRET" "$PUBLIC_BACKEND_URL/internal/jobs/certificates/issue" >> /var/log/lumify-certificates.log 2>&1
```

The job only creates a certificate for confirmed bookings whose round end date is before the
current UTC day. It is safe to repeat and also retries certificate email delivery without changing
the immutable generated PDF.

## 5. Production verification

After deployment, verify registration email delivery, OTP/reset flows, R2 upload and authorized
download, admin bootstrap/login, manual-payment receipt access, approval, protected course access,
cancellation completion, Swagger, and both `/health` and `/ready`. Also confirm that PostgreSQL is
not reachable from the public network and that an unconfirmed student cannot retrieve private
files, join links, materials, or recordings. Upload and inspect the certificate template, activate
it, invoke the issuance job with its secret, and verify both the student download and public QR
verification response before relying on the production cron.
