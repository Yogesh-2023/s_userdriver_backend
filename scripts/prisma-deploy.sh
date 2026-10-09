#!/bin/sh

# Try to run standard migrate deploy
echo "Running standard prisma migrate deploy..."
output=$(npx prisma migrate deploy 2>&1)
exit_code=$?

echo "$output"

# Check if the error is P3005 (Unbaselined db)
if [ $exit_code -ne 0 ] && echo "$output" | grep -q "P3005"; then
  echo "P3005 detected. Baselining existing database..."
  
  for dir in prisma/migrations/*/; do
    migration=$(basename "$dir")
    if [ "$migration" = "20261008190104_map_year_to_model" ]; then
      echo "Skipping baselining for new migration: $migration"
      continue
    fi
    echo "Baselining: $migration"
    npx prisma migrate resolve --applied "$migration" || true
  done
  
  echo "Retrying prisma migrate deploy to apply pending migrations..."
  npx prisma migrate deploy
  exit_code=$?
fi

# Check if the error is P3009 (Failed migration)
if [ $exit_code -ne 0 ] && echo "$output" | grep -q "P3009"; then
  echo "P3009 detected. Rolling back failed migrations..."
  
  # Extract the failed migration name using grep and awk
  failed_migration=$(echo "$output" | grep "The \`" | grep "\` migration started" | awk -F'\`' '{print $2}')
  
  if [ -n "$failed_migration" ]; then
    echo "Found failed migration: $failed_migration. Marking as rolled back..."
    npx prisma migrate resolve --rolled-back "$failed_migration"
    
    echo "Retrying prisma migrate deploy..."
    npx prisma migrate deploy
    exit_code=$?
  else
    echo "Could not parse failed migration name. Exiting."
  fi
fi

exit $exit_code
