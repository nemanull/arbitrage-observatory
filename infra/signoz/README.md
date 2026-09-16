# SigNoz

Local observability backend for logs, traces, and metrics.
It exists so that a failure in a background job is still readable hours later, when nobody was watching the terminal.

## Running it

SigNoz is part of the root [`docker-compose.yaml`](../../docker-compose.yaml), so it starts with everything else.

```
pnpm infra:up      # Postgres, Redis, and SigNoz
pnpm infra:down    # stop
pnpm infra:logs    # tail every container
```

Only Postgres and Redis are needed to run the server.
To skip SigNoz on a constrained machine, start those two by name instead.

```
docker compose up -d --wait postgres redis
```

## Where things listen

Every port is bound to `127.0.0.1` and shifted off its default, matching the Postgres and Redis convention in the root compose file.

| What | URL | Override |
| --- | --- | --- |
| SigNoz UI | http://localhost:8180 | `SIGNOZ_PORT` |
| OTLP over HTTP | http://localhost:4418 | `SIGNOZ_OTLP_HTTP_PORT` |
| OTLP over gRPC | http://localhost:4417 | `SIGNOZ_OTLP_GRPC_PORT` |
| ClickHouse memory cap | 3g | `SIGNOZ_CLICKHOUSE_MEM_LIMIT` |

The server ships to the HTTP endpoint.
It reads `OTEL_EXPORTER_OTLP_ENDPOINT` from [`server/.env`](../../server/.env.example), and exports nothing when that variable is empty.

## The account is not optional

SigNoz drops every signal until an account exists, and it does so silently.

The collector does not read its own config file for long.
It connects to the SigNoz backend over OpAMP and runs whatever config the backend hands back.
Before the first account is created there is no organisation to attach the collector to, the backend answers `cannot create agent without orgId`, and the collector falls back to a config whose pipelines are all `nop`.
In that state nothing listens on 4317 or 4318, the exporter on the server side fails with `socket hang up`, and no error appears in the SigNoz UI because nothing ever reached it.

So open http://localhost:8180 and create the account before expecting data.
The container registers nothing outbound, so any email and password work, though the email has to have a real looking domain.
The collector picks up the real config on its own within about thirty seconds.
No restart is needed.

The account lives in the metastore volume, so it survives a restart and is created once per machine.
Drop that volume to start over.

## What runs

Five long lived containers and two one shot jobs.

- `signoz-signoz-0` serves the UI and the query API.
- `ingester` is the OpenTelemetry collector that receives OTLP and writes to ClickHouse.
- `signoz-telemetrystore-clickhouse-0-0` stores the telemetry.
- `signoz-telemetrykeeper-clickhousekeeper-0` is the ClickHouse coordinator.
- `signoz-metastore-postgres-0` stores SigNoz's own dashboards and users, separate from the observatory database.
- `signoz-telemetrystore-migrator` and `signoz-telemetrystore-clickhouse-user-scripts` run once at startup and exit.

Idle resident memory measured just under 600 MB in total, most of it ClickHouse.
The images for `signoz-signoz-0` and the collector are tagged `latest`, which is what the generator emits.
SigNoz ships the backend and the collector as a matched pair, so pinning one without the other is worse than pinning neither.

## Where these files come from

SigNoz stopped shipping Compose files in its own repository at v0.130.0 and moved to a generator called Foundry.
`foundryctl forge` turns a `casting.yaml` into deployment manifests and `foundryctl cast` applies them.
The generated single node Docker output is published in the [SigNoz/foundry](https://github.com/SigNoz/foundry) repository, so these files are copied from there rather than generated locally.
That keeps `foundryctl` off the list of things a fresh checkout needs.

[`casting.yaml`](./telemetrystore/clickhouse/casting.yaml) is the Foundry input that produced this output.
It is kept for reference and is not read by anything here.

## Upgrading

```
./refresh.sh
git diff infra/signoz
```

The fetched [`compose.yaml`](./compose.yaml) is raw generator output, so the five blocks marked `Local edit` have to be restored.

1. Loopback and shifted ports on `ingester` and `signoz-signoz-0`.
2. `mem_limit` on `signoz-telemetrystore-clickhouse-0-0`, because ClickHouse otherwise sizes its budget against all host memory.
3. `depends_on` on `ingester` and `signoz-signoz-0`.
   These order the startup correctly, and they are also what keeps `docker compose up --wait` exiting 0.
   Compose treats any exited service as a failure unless something declares it with `condition: service_completed_successfully`, and this stack has two one shot jobs.
4. No `container_name`, and no fixed network or volume names.
   The generator writes names that are global to the Docker daemon, which means a second SigNoz on the same host collides with this one, and `docker volume rm` in one project destroys the other project's telemetry.
   Dropping the names scopes all three to the Compose project.
   Service names are untouched, and Compose aliases every service by name on its network, so the hostnames inside the config files still resolve.
5. `SIGNOZ_TOKENIZER_JWT_SECRET` on `signoz-signoz-0`, because SigNoz otherwise signs session tokens with no secret and logs a critical warning on every boot.

## Wiping stored telemetry

`pnpm infra:reset` removes the observatory database as well.
To drop only what SigNoz stored, including the account:

```
docker compose down
docker volume rm \
  arbitrage-observatory_signoz-telemetrystore-0-0-data \
  arbitrage-observatory_signoz-metastore-postgres-0-data \
  arbitrage-observatory_signoz-telemetrykeeper-0-data
```

The volumes are prefixed with the Compose project name, which is what keeps them clear of any other SigNoz on the same host.
