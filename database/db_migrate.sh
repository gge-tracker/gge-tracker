#!/usr/bin/env bash
#                                   __                        __
#    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
#   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
#  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
#  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
# /_____//_____/      \/                            \/     \/     \/    \/
#
#  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
#
# Database migration script for MariaDB, PostgreSQL, and ClickHouse
# This script applies structure migrations and seeds data for development purposes
# It logs all actions and errors to a timestamped log file in the logs/ directory

cd "$(dirname "$0")"

if [ "$(hostname)" != "database-migrate" ]; then
  echo -e "\e[31mError: This script must be run inside the 'database-migrate' container and cannot be run directly on the host.\nPlease use 'docker-compose' command to run it.\e[0m"
  exit 1
fi

# Script usage:
# docker compose run --build --rm database-migrate bash ./db_migrate.sh
# docker compose run --build --rm database-migrate bash ./db_migrate.sh --clean
# docker compose run --build --rm database-migrate bash ./db_migrate.sh --clear-logs

export MARIADB_CONTAINER_NAME="mariadb-container"
export POSTGRES_CONTAINER_NAME="postgres-container"
export CLICKHOUSE_CONTAINER_NAME="clickhouse"

readonly PG_SQL_NB_DATABASES=23
readonly CLICKHOUSE_NB_DATABASES=25
readonly MARIADB_NB_DATABASES=10

readonly DATABASES_TXT="databases.txt"
SEED_FILE="seed.sql"

readonly STRUCTURE_FILE="structure.sql"
readonly CREATE_FILE="create-seed-file.sh"
readonly MAP_GLOBAL_RANKING="map-global-ranking.sh"

readonly TARGET_LOG_FILE="$(pwd)/logs/$(date +'%Y-%m-%d_%H-%M-%S')_db_migration.log"

mkdir -p "$(dirname "$TARGET_LOG_FILE")"
> "$TARGET_LOG_FILE"

readonly MARIADB_PATH="$(pwd)/mariadb"
readonly POSTGRES_PATH="$(pwd)/postgres"
readonly CLICKHOUSE_PATH="$(pwd)/clickhouse"
WITH_SEED=true

readonly start_time=$(date +%s)

parse_params() {
  for param in "$@"; do
    case $param in
      --clean)
        log "Clean option detected. Dropping all databases before applying migrations..." "info"
        drop_all_postgres_databases
        drop_all_clickhouse_databases
        drop_all_mariadb_databases
        shift
        ;;
      --clear-logs)
        log "Clear logs option detected. Deleting all old log files..." "info"
        rm -f logs/*.log
        log "Old log files deleted." "success"
        shift
        ;;
      --no-seed)
        log "No-seed option detected. Skipping data seeding after migrations." "info"
        WITH_SEED=false
        shift
        ;;
      *)
        log "Unknown parameter: $param" "error"
        exit 1
        ;;
    esac
  done
}

# Main execution flow
# This script is designed to be idempotent and can be run multiple times safely
main() {
  parse_params "$@"
  verify_variables
  verify_access_to_databases
  log "Starting database migration script..." info
  if ( set -e; verify_mariadb_filled ); then
    log "[MariaDB] Database is already filled. Skipping migrations." "success"
  else
    drop_all_mariadb_databases
    create_mariadb_first_database
    execute_mariadb
  fi

  if ( set -e; verify_postgres_filled ); then
    log "[PostgreSQL] Database is already filled. Skipping migrations." "success"
  else
    drop_all_postgres_databases
    create_postgres_structure
    execute_postgres
  fi

  if ( set -e; verify_clickhouse_filled ); then
    log "[ClickHouse] Database is already filled. Skipping migrations." "success"
  else
    drop_all_clickhouse_databases
    create_clickhouse_structure
    execute_clickhouse
  fi
}

verify_access_to_databases() {
  log "Verifying access to database containers..." "info"

  if ! docker ps --format '{{.Names}}' | grep -q "^$MARIADB_CONTAINER_NAME$"; then
    log "Error: The MariaDB container '$MARIADB_CONTAINER_NAME' is not running." "error"
    exit 1
  fi

  if ! docker ps --format '{{.Names}}' | grep -q "^$POSTGRES_CONTAINER_NAME$"; then
    log "Error: The PostgreSQL container '$POSTGRES_CONTAINER_NAME' is not running." "error"
    exit 1
  fi

  if ! docker ps --format '{{.Names}}' | grep -q "^$CLICKHOUSE_CONTAINER_NAME$"; then
    log "Error: The ClickHouse container '$CLICKHOUSE_CONTAINER_NAME' is not running." "error"
    exit 1
  fi

  log "Access to all database containers verified."
}

verify_variables() {
  log "Verifying required environment variables..." "info"
  REQUIRED_VARS=(
    "SQL_USER"
    "SQL_PASSWORD"
    "SQL_ROOT_PASSWORD"
    "SQL_DATABASE"
    "PG_HOST"
    "MARIADB_HOST"
    "CLICKHOUSE_HOST"
    "CLICKHOUSE_USER"
    "CLICKHOUSE_PASSWORD"
  )
  for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR:-}" ]; then
      log "Error: Environment variable $VAR is not set." "error"
      exit 1
    fi
  done
  log "All required environment variables are set."
}

verify_postgres_filled() {
  if [ "$(docker ps -q -f name=$POSTGRES_CONTAINER_NAME)" ]; then
    log "[PostgreSQL] Verifying if PostgreSQL database is already filled..." "info"
    DATABASES=$(docker exec -i "$POSTGRES_CONTAINER_NAME" psql -U "$SQL_USER" -d postgres -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[PostgreSQL] Error fetching databases from PostgreSQL." "error"
      exit 1
    fi
    NB_DATABASES=$(echo "$DATABASES" | wc -l)
    log "[PostgreSQL] Number of databases found: $NB_DATABASES" "info"
    if [ "$NB_DATABASES" -ge "$PG_SQL_NB_DATABASES" ]; then
      log "[PostgreSQL] PostgreSQL is already filled." "info"
      exit 0
    else
      log "[PostgreSQL] PostgreSQL is empty. Proceeding with migrations."
      exit 1
    fi
  else
    log "[PostgreSQL] Container is not running. Skipping verification."
  fi
}

verify_clickhouse_filled() {
  if [ "$(docker ps -q -f name=$CLICKHOUSE_CONTAINER_NAME)" ]; then
    log "[ClickHouse] Verifying if ClickHouse database is already filled..." "info"
    DATABASES=$(docker exec -i "$CLICKHOUSE_CONTAINER_NAME" clickhouse-client --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" --query="SHOW DATABASES;") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[ClickHouse] Error fetching databases from ClickHouse." "error"
      exit 1
    fi
    NB_DATABASES=$(echo "$DATABASES" | wc -l)
    log "[ClickHouse] Number of databases found: $NB_DATABASES" "info"
    if [ "$NB_DATABASES" -ge "$CLICKHOUSE_NB_DATABASES" ]; then
      exit 0
    else
      log "[ClickHouse] ClickHouse is empty. Proceeding with migrations."
      exit 1
    fi
  else
    log "[ClickHouse] Container is not running. Skipping verification."
  fi
}

verify_mariadb_filled() {
  if [ "$(docker ps -q -f name=$MARIADB_CONTAINER_NAME)" ]; then
    log "[MariaDB] Verifying if MariaDB database is already filled..." "info"
    DATABASES=$(docker exec -e MYSQL_PWD="$SQL_ROOT_PASSWORD" -i "$MARIADB_CONTAINER_NAME" \
    sh -c "exec mariadb -u root -e 'SHOW DATABASES;'") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[MariaDB] Error fetching databases from MariaDB." "error"
      exit 1
    fi
    NB_DATABASES=$(echo "$DATABASES" | wc -l)
    log "[MariaDB] Number of databases found: $NB_DATABASES" "info"
    if [ "$NB_DATABASES" -ge "$MARIADB_NB_DATABASES" ]; then
      exit 0
    else
      log "[MariaDB] MariaDB is empty. Proceeding with migrations."
      exit 1
    fi
  else
    log "[MariaDB] Container is not running. Skipping verification."
  fi
}

show_footer() {
  exit_code=$?
  end_time=$(date +%s)
  duration=$((end_time - start_time))
  if [ $exit_code -ne 0 ]; then
    color="error"
  else
    color=""
  fi
  log "" $color
  log "----------------------------------------" $color
  log "" $color
  log "Total execution time: $duration seconds." $color
  if [ $exit_code -ne 0 ]; then
    log "Database migration script encountered errors." $color
  else
    log "Database migration script completed successfully." $color
  fi
  log "" $color
  log "Log file: $TARGET_LOG_FILE" $color
  log "----------------------------------------" $color
}

trap 'show_footer; exit 1' ERR
trap 'show_footer; exit 0' EXIT

log() {
  GREEN="\e[32m"
  RED="\e[31m"
  BLUE="\e[34m"
  YELLOW="\e[33m"
  ENDCOLOR="\e[0m"
  STATUS=${2:-}
  hour=$(date +'%H:%M:%S')
  if [[ $STATUS == "error" ]]; then
    echo -e "[$hour] ${RED}[ ERROR ] $1${ENDCOLOR}" | tee -a "$TARGET_LOG_FILE"
  elif [[ $STATUS == "warning" ]]; then
    echo -e "[$hour] ${YELLOW}[ WARNING ] $1${ENDCOLOR}" | tee -a "$TARGET_LOG_FILE"
  elif [[ $STATUS == "info" ]]; then
    echo -e "[$hour] ${BLUE}[ INFO ] $1${ENDCOLOR}" | tee -a "$TARGET_LOG_FILE"
  else
    echo -e "[$hour] ${GREEN}[ SUCCESS ] $1${ENDCOLOR}" | tee -a "$TARGET_LOG_FILE"
  fi
}

execute_clickhouse() {
  log "[ClickHouse] Verifying structure for ClickHouse..." "info"
  if [ "$(docker ps -q -f name=$CLICKHOUSE_CONTAINER_NAME)" ]; then
    log "[ClickHouse] Checking structure..." "info"
    DATABASES=$(docker exec -i "$CLICKHOUSE_CONTAINER_NAME" clickhouse-client --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" --query="SHOW DATABASES;") >> "$TARGET_LOG_FILE" 2>&1
    SYS_DATABASES="default system information_schema INFORMATION_SCHEMA"
    for DB in $DATABASES; do
      if echo "$SYS_DATABASES" | grep -qw "$DB"; then
        DATABASES=$(echo "$DATABASES" | grep -vw "$DB")
      fi
    done
    NB_DATABASES=$(echo "$DATABASES" | wc -l)
    log "[ClickHouse] Success. Number of databases: $NB_DATABASES"

    if [ "$WITH_SEED" = true ]; then
      log "[ClickHouse] Importing sql seed file into all databases..." "info"
      i=1
      for DB in $DATABASES; do
        log "[ClickHouse] Importing seed into database: $DB... ($i/$NB_DATABASES)" "info"
        ((i++))
        TABLES=$(docker exec -i "$CLICKHOUSE_CONTAINER_NAME" clickhouse-client --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" --database="$DB" --query="SHOW TABLES;") >> "$TARGET_LOG_FILE" 2>&1
        if [ $? -ne 0 ]; then
          log "[ClickHouse] Error fetching tables from database: $DB." "error"
          exit 1
        fi
        for TABLE in $TABLES; do
          CSV_FILE="$CLICKHOUSE_PATH/data/$TABLE.csv"
          if [ -f "$CSV_FILE" ]; then
            log "[ClickHouse] Importing $CSV_FILE into $DB.$TABLE..." "info"
            docker exec -i "$CLICKHOUSE_CONTAINER_NAME" clickhouse-client --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" --database="$DB" --query="INSERT INTO $TABLE FORMAT CSV" < "$CSV_FILE" >> "$TARGET_LOG_FILE" 2>&1
            if [ $? -ne 0 ]; then
              log "[ClickHouse] Error importing $CSV_FILE into $DB.$TABLE." "error"
              exit 1
            fi
            log "[ClickHouse] Import successful"
          else
            log "[ClickHouse] Warning: CSV file $CSV_FILE not found. Skipping import for table $TABLE." "warning"
          fi
        done
        if [ $? -ne 0 ]; then
          log "[ClickHouse] Error importing seed into database: $DB." "error"
          exit 1
        fi
        log "[ClickHouse] Seed imported into database: $DB."
      done
      log "[ClickHouse] All databases have been seeded."
    fi
    log "[ClickHouse] ClickHouse is ready."
  else
    log "[ClickHouse] Container is not running. Skipping migrations."
  fi
}

create_clickhouse_structure() {
  if [ "$(docker ps -q -f name=$CLICKHOUSE_CONTAINER_NAME)" ]; then
    log "[ClickHouse] Copying structure file to container..." "info"
    docker cp "$CLICKHOUSE_PATH/$STRUCTURE_FILE" $CLICKHOUSE_CONTAINER_NAME:/"$STRUCTURE_FILE" >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[ClickHouse] Error copying structure file to container." "error"
      exit 1
    fi
    log "[ClickHouse] Applying structure migrations..." "info"
    docker exec -i $CLICKHOUSE_CONTAINER_NAME clickhouse-client --multiquery --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" < "$CLICKHOUSE_PATH/$STRUCTURE_FILE" >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[ClickHouse] Error applying migrations." "error"
      exit 1
    fi
    log "[ClickHouse] Structure migrations applied."
  else
    log "[ClickHouse] Container is not running. Skipping structure creation." "info"
  fi
}

create_mariadb_first_database() {
  if [ "$(docker ps -q -f name=$MARIADB_CONTAINER_NAME)" ]; then
    log "[MariaDB] Creating initial database '$SQL_DATABASE'..." "info"
    docker exec -i $MARIADB_CONTAINER_NAME mariadb -u root -p"$SQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS \`$SQL_DATABASE\`;" >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[MariaDB] Error creating database." "error"
      exit 1
    fi
    log "[MariaDB] Structure migrations applied."
  else
    log "[MariaDB] Container is not running. Skipping structure creation." "info"
  fi
}

create_postgres_structure() {
  if [ "$(docker ps -q -f name=$POSTGRES_CONTAINER_NAME)" ]; then
    log "[PostgreSQL] Copying structure file to container..." "info"
    docker cp "$POSTGRES_PATH/$STRUCTURE_FILE" $POSTGRES_CONTAINER_NAME:/docker-entrypoint-initdb.d/"$STRUCTURE_FILE" >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[PostgreSQL] Error copying structure file to container." "error"
      exit 1
    fi
    log "[PostgreSQL] Applying structure migrations..." "info"
    docker exec -i $POSTGRES_CONTAINER_NAME psql -U "$SQL_USER" -d "postgres" -f "/docker-entrypoint-initdb.d/$STRUCTURE_FILE" >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[PostgreSQL] Error applying migrations." "error"
      exit 1
    fi
    log "[PostgreSQL] Structure migrations applied."
  else
    log "[PostgreSQL] Container is not running. Skipping structure creation." "info"
  fi
}

execute_postgres() {
  if [ "$(docker ps -q -f name=$POSTGRES_CONTAINER_NAME)" ]; then
    log "[PostgreSQL] Verifying structure for PostgreSQL..." "info"
    DATABASES=$(docker exec -i $POSTGRES_CONTAINER_NAME psql -U "$SQL_USER" -d "postgres" -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;") >> "$TARGET_LOG_FILE" 2>&1
    SYS_DATABASES="template0 template1 postgres"
    for DB in $DATABASES; do
      if echo "$SYS_DATABASES" | grep -qw "$DB"; then
        DATABASES=$(echo "$DATABASES" | grep -vw "$DB")
      fi
    done
    NB_DATABASES=$(echo "$DATABASES" | wc -l)
    log "[PostgreSQL] Preliminary check successful. Number of databases: $NB_DATABASES"
    if [ "$WITH_SEED" = true ]; then
      log "[PostgreSQL] Importing CSV seed file into all databases..." "info"
      i=0
      for DB in $DATABASES; do
        R_NB_DATABASES=$((NB_DATABASES))
        ((i++))
        if  [ "$DB" == "empire-ranking-global" ]; then
          log "[PostgreSQL] Skipping seeding for database: $DB. ($i/$R_NB_DATABASES)" "info"
          continue
        fi
        log "[PostgreSQL] Importing seed into database: $DB... ($i/$R_NB_DATABASES)" "info"
        for csv_file in "$POSTGRES_PATH/data/"*.csv; do
          [ -e "$csv_file" ] || continue
          echo "[PostgreSQL] Importing $csv_file into $DB..." >> "$TARGET_LOG_FILE" 2>&1
          sql_table_name=$(basename "$csv_file" .csv | sed 's/^[0-9]*-//')
          docker exec -i "$POSTGRES_CONTAINER_NAME" psql -U "$SQL_USER" -d "$DB" -c "\copy $sql_table_name FROM STDIN WITH CSV HEADER NULL 'NULL'" < "$csv_file" >> "$TARGET_LOG_FILE" 2>&1
          if [ $? -ne 0 ]; then
            log "[PostgreSQL] Error importing $csv_file into $DB." "error"
            exit 1
          fi
          echo "[PostgreSQL] Imported $csv_file into $DB." >> "$TARGET_LOG_FILE" 2>&1
        done
        log "[PostgreSQL] Successfully imported seed into database: $DB."
      done
      log "[PostgreSQL] All databases have been seeded."
      log "[PostgreSQL] Executing global ranking mapping script..." "info"
      ${POSTGRES_PATH}/${MAP_GLOBAL_RANKING} >> "$TARGET_LOG_FILE" 2>&1
      if [ $? -ne 0 ]; then
        log "[PostgreSQL] Error executing global ranking mapping script." "error"
        exit 1
      fi
      log "[PostgreSQL] Script ended. Postgres is ready."
    fi
  else
    log "[PostgreSQL] Container is not running. Skipping migrations."
  fi
}

drop_all_clickhouse_databases() {
  if [ "$(docker ps -q -f name=$CLICKHOUSE_CONTAINER_NAME)" ]; then
    log "[ClickHouse] Dropping all ClickHouse databases..." "info"
    DATABASES=$(docker exec -i "$CLICKHOUSE_CONTAINER_NAME" clickhouse-client --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" --query="SHOW DATABASES;") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[ClickHouse] Error dropping databases." "error"
      exit 1
    fi
    SYS_DATABASES="default system information_schema INFORMATION_SCHEMA"
    for DB in $DATABASES; do
      if echo "$SYS_DATABASES" | grep -qw "$DB"; then
        DATABASES=$(echo "$DATABASES" | grep -vw "$DB")
      fi
    done
    count=$(echo "$DATABASES" | wc -l)
    log "[ClickHouse] Number of databases to drop: $count" "info"
    i=0
    for DB in $DATABASES; do
      ((i++))
      log "[ClickHouse] Dropping database ($i/$count): $DB..." "info"
      docker exec -i "$CLICKHOUSE_CONTAINER_NAME" clickhouse-client --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD" --query="DROP DATABASE IF EXISTS $DB;" >> "$TARGET_LOG_FILE" 2>&1
      if [ $? -ne 0 ]; then
        log "[ClickHouse] Error dropping database: $DB." "error"
        exit 1
      fi
      log "[ClickHouse] Database $DB dropped."
    done
    log "[ClickHouse] All user databases and objects dropped."
  else
    log "[ClickHouse] Container is not running. Skipping cleanup." "info"
  fi
}

drop_all_postgres_databases() {
  if [ "$(docker ps -q -f name=$POSTGRES_CONTAINER_NAME)" ]; then
    log "[PostgreSQL] Dropping databases and objects..." "info"
    DATABASES=$(docker exec -i "$POSTGRES_CONTAINER_NAME" psql -U "$SQL_USER" -d postgres -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[PostgreSQL] Error dropping databases." "error"
      exit 1
    fi
    SYS_DATABASES="template0 template1 postgres"
    for DB in $DATABASES; do
      if echo "$SYS_DATABASES" | grep -qw "$DB"; then
        DATABASES=$(echo "$DATABASES" | grep -vw "$DB")
      fi
    done
    count=$(echo "$DATABASES" | wc -l)
    log "[PostgreSQL] Number of databases to drop: $count" "info"
    i=0
    for DB in $DATABASES; do
      ((i++))
      log "[PostgreSQL] Dropping database ($i/$count): $DB..." "info"
      docker exec -i "$POSTGRES_CONTAINER_NAME" psql -U "$SQL_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >> "$TARGET_LOG_FILE" 2>&1
      if [ $? -ne 0 ]; then
        log "[PostgreSQL] Error dropping database: $DB." "error"
        exit 1
      fi
      log "[PostgreSQL] Database $DB dropped."
    done
    log "[PostgreSQL] Cleaning remaining objects in 'postgres' database..." "info"
    docker exec -i "$POSTGRES_CONTAINER_NAME" psql -U "$SQL_USER" -d postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO \"$SQL_USER\"; GRANT ALL ON SCHEMA public TO public;" >> "$TARGET_LOG_FILE" 2>&1
    log "[PostgreSQL] All user databases and objects dropped."
  else
    log "[PostgreSQL] Container is not running. Skipping cleanup." "info"
  fi
}

drop_all_mariadb_databases() {
  if [ "$(docker ps -q -f name=$MARIADB_CONTAINER_NAME)" ]; then
    log "[MariaDB] Dropping all MariaDB databases..." "info"
    DATABASES=$(docker exec -e MYSQL_PWD="$SQL_ROOT_PASSWORD" -i "$MARIADB_CONTAINER_NAME" \
    sh -c "exec mariadb -u root -e 'SHOW DATABASES;'") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[MariaDB] Error dropping databases." "error"
      exit 1
    fi
    SYS_DATABASES="Database information_schema mysql performance_schema sys"
    for DB in $DATABASES; do
      if echo "$SYS_DATABASES" | grep -qw "$DB"; then
        DATABASES=$(echo "$DATABASES" | grep -vw "$DB")
      fi
    done
    count=$(echo "$DATABASES" | wc -l)
    log "[MariaDB] Number of databases to drop: $count" "info"
    i=0
    for DB in $DATABASES; do
      ((i++))
      log "[MariaDB] Dropping database ($i/$count): $DB..." "info"
      docker exec -e MYSQL_PWD="$SQL_ROOT_PASSWORD" -i "$MARIADB_CONTAINER_NAME" \
      sh -c "exec mariadb -u root -e 'DROP DATABASE IF EXISTS \`$DB\`;' " >> "$TARGET_LOG_FILE" 2>&1
      if [ $? -ne 0 ]; then
        log "[MariaDB] Error dropping database: $DB." "error"
        exit 1
      fi
      log "[MariaDB] Database $DB dropped."
    done
    log "[MariaDB] All user databases and objects dropped."
  else
    log "[MariaDB] Container is not running. Skipping cleanup." "info"
  fi
}

execute_mariadb() {
  log "[MariaDB] Running migrations for MariaDB..." "info"
  if [ "$(docker ps -q -f name=$MARIADB_CONTAINER_NAME)" ]; then
    log "[MariaDB] Applying structure migrations..."
    docker exec -i "$MARIADB_CONTAINER_NAME" mariadb -u root -p"$SQL_ROOT_PASSWORD" "$SQL_DATABASE" < "$MARIADB_PATH/$STRUCTURE_FILE" >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[MariaDB] Error applying structure migrations" "error"
      exit 1
    fi
    log "[MariaDB] Migrations completed."
    log "[MariaDB] Verifying migrations..." "info"
    DATABASES=$(docker exec -e MYSQL_PWD="$SQL_ROOT_PASSWORD" -i "$MARIADB_CONTAINER_NAME" \
    sh -c "exec mariadb -u root -e 'SHOW DATABASES;'") >> "$TARGET_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
      log "[MariaDB] Error verifying migration" "error"
      exit 1
    fi
    SYS_DATABASES="Database information_schema mysql performance_schema sys"
    for DB in $DATABASES; do
      if echo "$SYS_DATABASES" | grep -qw "$DB"; then
        DATABASES=$(echo "$DATABASES" | grep -vw "$DB")
      fi
    done
    NB_DATABASES=$(echo "$DATABASES" | wc -l)
    log "[MariaDB] Number of databases: $NB_DATABASES. Verification successful."
    if [ "$WITH_SEED" = true ]; then
      log "[MariaDB] Seeding data for development..." "info"
      DB_TXT="$MARIADB_PATH/$DATABASES_TXT"
      SEED_FILE="$MARIADB_PATH/$SEED_FILE"
      $MARIADB_PATH/$CREATE_FILE "$SEED_FILE" >> "$TARGET_LOG_FILE" 2>&1
      if [ $? -ne 0 ]; then
        log "[MariaDB] Error creating seed file." "error"
        exit 1
      fi
      log "[MariaDB] Seeding completed."
      log "[MariaDB] Importing seed file into all databases..." "info"
      for DB in $DATABASES; do
        log "[MariaDB] Preparing to import seed into database: $DB..." "info"
        echo "USE $DB;" | cat - "$SEED_FILE" > temp && mv temp "$SEED_FILE"
        log "[MariaDB] Successfully prepared seed file for database: $DB."
        log "[MariaDB] Importing seed into database: $DB..." "info"
        docker exec -i "$MARIADB_CONTAINER_NAME" mariadb -u root -p"$SQL_ROOT_PASSWORD" "$DB" < "$SEED_FILE" >> "$TARGET_LOG_FILE" 2>&1
        if [ $? -ne 0 ]; then
          log "[MariaDB] Error importing seed into database: $DB." "error"
          exit 1
        fi
        sed -i '/^USE '"$DB"';/d' "$SEED_FILE"
        log "[MariaDB] Seed imported into database: $DB."
      done
      log "[MariaDB] All databases have been seeded."
    fi
  else
    log "[MariaDB] Container is not running. Skipping migrations." "info"
  fi
}

main "$@"
