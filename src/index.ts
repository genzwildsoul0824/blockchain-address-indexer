import Fastify from 'fastify';
import { ValidationService } from './services/validation.service';
import { IndexerService } from './services/indexer.service';
import type { Block } from './types';

const fastify = Fastify({ logger: true });

// Health check endpoint
fastify.get('/', async () => {
  return { 
    status: 'ok', 
    service: 'Blockchain Address Indexer',
    endpoints: [
      'POST /blocks',
      'GET /balance/:address',
      'POST /rollback?height=number'
    ]
  };
});

// POST /blocks - Process a new block
fastify.post<{ Body: Block }>('/blocks', async (request, reply) => {
  try {
    const block = request.body;

    const validation = await ValidationService.validateBlock(block);
    if (!validation.valid) {
      return reply.code(400).send({
        success: false,
        error: validation.error,
      });
    }

    const processedBlock = await IndexerService.processBlock(block);

    return reply.code(201).send({
      success: true,
      message: 'Block processed successfully',
      block: {
        id: processedBlock.id,
        height: processedBlock.height,
        transactionsCount: processedBlock.transactions.length,
      },
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// GET /balance/:address - Get balance for an address
fastify.get<{ Params: { address: string } }>('/balance/:address', async (request, reply) => {
  try {
    const { address } = request.params;

    if (!address) {
      return reply.code(400).send({
        error: 'Address is required',
      });
    }

    const balance = await IndexerService.getBalance(address);

    return reply.send({
      address,
      balance,
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// POST /rollback?height=number - Rollback to a specific height
fastify.post<{ Querystring: { height: string } }>('/rollback', async (request, reply) => {
  try {
    const heightParam = request.query.height;

    if (!heightParam) {
      return reply.code(400).send({
        success: false,
        error: 'Height query parameter is required',
      });
    }

    const height = parseInt(heightParam, 10);

    if (isNaN(height) || height < 0) {
      return reply.code(400).send({
        success: false,
        error: 'Height must be a valid non-negative number',
      });
    }

    const result = await IndexerService.rollbackToHeight(height);

    return reply.send(result);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// Start server
async function start() {
  try {
    console.log('Starting Blockchain Address Indexer...');
    
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    await fastify.listen({
      port: 3000,
      host: '0.0.0.0',
    });

    console.log('Server is running on http://0.0.0.0:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();