FROM postgres:18.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl pv zstd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backup.sh scheduler.sh ./
RUN chmod +x backup.sh scheduler.sh

ENTRYPOINT ["/app/scheduler.sh"]
