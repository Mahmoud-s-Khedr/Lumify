# Local community simulation

Start the API and database with the project's local environment file:

```bash
docker compose up --build -d
docker compose ps
```

The scripts run from the host and exercise the Docker-hosted API at `PUBLIC_BACKEND_URL` from
`.env` (or `SIMULATION_API_URL` when supplied). They use the configured bootstrap administrator,
create two unique fake students, and retain a private run-state file at
`tmp/community-simulation.json` for inspection.

Run the complete scenario:

```bash
npm run simulate:community
```

It performs real registration and OTP verification, R2 receipt and community-attachment uploads,
student booking/payment submission, admin approval, authenticated Socket.IO room joining, message
broadcasting, attachment download authorization, read events, message deletion, and REST-history
verification.

The role scripts can also be run separately:

```bash
npm run simulate:community:admin -- setup
npm run simulate:community:students -- enroll
npm run simulate:community:admin -- approve
npm run simulate:community:students -- chat
```

The scenario intentionally leaves the generated course, users, messages, payment method, and R2
objects intact so they can be inspected. Every generated value contains a unique simulation run ID.
Use a non-production environment only.
