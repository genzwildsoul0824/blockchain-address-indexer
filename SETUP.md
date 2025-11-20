# Blockchain Address Indexer - Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Start with Docker (Recommended)

This will start both PostgreSQL and the API:

```bash
bun run-docker
```

### 3. Initialize Database

In a new terminal, run Prisma migrations:

```bash
# Generate Prisma Client
bun run prisma:generate

# Push schema to database (for development)
bun run prisma:push
```

### 4. Test the API

The API will be running on `http://localhost:3000`

#### Health Check
```bash
curl http://localhost:3000
```

#### Add a block
```bash
curl -X POST http://localhost:3000/blocks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
    "height": 1,
    "transactions": [{
      "id": "tx1",
      "inputs": [],
      "outputs": [{
        "address": "addr1",
        "value": 10
      }]
    }]
  }'
```

#### Get balance
```bash
curl http://localhost:3000/balance/addr1
```

#### Rollback
```bash
curl -X POST "http://localhost:3000/rollback?height=0"
```

## Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch
```

## Development Without Docker

If you want to run without Docker:

### 1. Install PostgreSQL locally

### 2. Set environment variable

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/indexer_db"
```

### 3. Run migrations

```bash
bun run prisma:generate
bun run prisma:push
```

### 4. Start the server

```bash
bun start
```

## Project Structure

```
src/
├── index.ts                          # Main API server
├── types.ts                          # TypeScript type definitions
├── lib/
│   └── prisma.ts                     # Prisma client singleton
├── services/
│   ├── validation.service.ts         # Block and transaction validation
│   └── indexer.service.ts            # Core indexer logic
└── examples/
    └── prisma-transactions.example.ts # Prisma transaction examples

spec/
└── index.spec.ts                     # Comprehensive test suite

prisma/
└── schema.prisma                     # Database schema
```

## API Endpoints

### POST /blocks
Process a new block and update address balances.

**Request Body:**
```json
{
  "id": "block-hash",
  "height": 1,
  "transactions": [{
    "id": "tx-id",
    "inputs": [],
    "outputs": [{
      "address": "address",
      "value": 100
    }]
  }]
}
```

**Validations:**
- Height must be exactly one unit higher than current height (first block must be height 1)
- Block ID must be sha256(height + tx1.id + tx2.id + ...)
- For each transaction, sum of inputs must equal sum of outputs
- Inputs must reference valid, unspent outputs

### GET /balance/:address
Get the current balance for an address.

**Response:**
```json
{
  "address": "addr1",
  "balance": 100
}
```

### POST /rollback?height=number
Rollback the blockchain state to a specific height.

**Query Parameters:**
- `height`: Target height to rollback to

**Response:**
```json
{
  "success": true,
  "message": "Rolled back from height 5 to 3",
  "newHeight": 3,
  "blocksRemoved": 2
}
```

## Database Schema

The indexer uses a UTXO (Unspent Transaction Output) model:

- **Block**: Stores block metadata (id, height)
- **Transaction**: Stores transaction data linked to blocks
- **Input**: References to spent outputs
- **Output**: Transaction outputs with address, value, and spent status
- **AddressBalance**: Cached balance for each address

## Prisma Commands

```bash
# Generate Prisma Client
bun run prisma:generate

# Create and apply migrations
bun run prisma:migrate

# Push schema to database (development)
bun run prisma:push

# Open Prisma Studio (database GUI)
bun run prisma:studio
```

## Tips

1. **Block IDs**: Use the helper function to generate correct block IDs:
   ```typescript
   import { createHash } from 'crypto';
   
   const blockId = createHash('sha256')
     .update(height + tx1.id + tx2.id + ...)
     .digest('hex');
   ```

2. **Testing**: The test suite includes examples of all operations

3. **Debugging**: Use Prisma Studio to inspect the database:
   ```bash
   bun run prisma:studio
   ```

4. **Logs**: The server uses Fastify's built-in logger for request/response logging

