FROM alpine/git:2.49.1 AS base
WORKDIR /app

RUN git clone --depth=1 --branch=main https://github.com/gge-tracker/database-csv.git /app/database-csv
RUN rm -rf ./.git
RUN if [ ! -d /app/database-csv/clickhouse ]; then echo "Error: /app/database-csv/clickhouse directory not found!"; ls -la /app/database-csv && exit 1; fi

FROM docker:27.0-cli AS final

RUN apk add --no-cache bash
WORKDIR /scripts

COPY . .
COPY --from=base /app/database-csv/ /scripts/


RUN if [ ! -d /scripts/clickhouse ]; then echo "Error: /scripts/clickhouse directory not found!"; ls -la /scripts && exit 1; fi

