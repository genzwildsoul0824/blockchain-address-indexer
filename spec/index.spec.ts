import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { createHash } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { ValidationService } from '../src/services/validation.service';
import { IndexerService } from '../src/services/indexer.service';
import type { Block, Transaction } from '../src/types';

// Helper function to create block ID
function createBlockId(height: number, transactions: Transaction[]): string {
  const concatenated = height + transactions.map(tx => tx.id).join('');
  return createHash('sha256').update(concatenated).digest('hex');
}

// Clean up database before and after tests
beforeAll(async () => {
  await prisma.addressBalance.deleteMany();
  await prisma.output.deleteMany();
  await prisma.input.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.block.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.addressBalance.deleteMany();
  await prisma.output.deleteMany();
  await prisma.input.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.block.deleteMany();
});

describe('ValidationService', () => {
  describe('validateHeight', () => {
    test('should accept height 1 when no blocks exist', async () => {
      const result = await ValidationService.validateHeight(1);
      expect(result.valid).toBe(true);
    });

    test('should reject height 2 when no blocks exist', async () => {
      const result = await ValidationService.validateHeight(2);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected 1, got 2');
    });

    test('should accept correct sequential height', async () => {
      // Create a block at height 1
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Validate height 2
      const result = await ValidationService.validateHeight(2);
      expect(result.valid).toBe(true);
    });

    test('should reject skipped height', async () => {
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      const result = await ValidationService.validateHeight(3);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected 2, got 3');
    });
  });

  describe('validateBlockId', () => {
    test('should accept valid block ID', () => {
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };

      const result = ValidationService.validateBlockId(block);
      expect(result.valid).toBe(true);
    });

    test('should reject invalid block ID', () => {
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block: Block = {
        id: 'invalid-id',
        height: 1,
        transactions: [tx1],
      };

      const result = ValidationService.validateBlockId(block);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid block ID');
    });
  });

  describe('validateTransactionBalances', () => {
    test('should accept transaction with no inputs (coinbase)', async () => {
      const tx: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 50 }],
      };

      const result = await ValidationService.validateTransactionBalances([tx]);
      expect(result.valid).toBe(true);
    });

    test('should accept transaction with matching input/output sums', async () => {
      // First create a block with an output to spend
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Now validate a transaction that spends it
      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [
          { address: 'addr2', value: 4 },
          { address: 'addr3', value: 6 },
        ],
      };

      const result = await ValidationService.validateTransactionBalances([tx2]);
      expect(result.valid).toBe(true);
    });

    test('should reject transaction with mismatched input/output sums', async () => {
      // First create a block with an output to spend
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Try to spend more than available
      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [{ address: 'addr2', value: 20 }],
      };

      const result = await ValidationService.validateTransactionBalances([tx2]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Input sum (10) does not equal output sum (20)');
    });

    test('should reject transaction referencing non-existent output', async () => {
      const tx: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'nonexistent', index: 0 }],
        outputs: [{ address: 'addr2', value: 10 }],
      };

      const result = await ValidationService.validateTransactionBalances([tx]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Input references non-existent output');
    });

    test('should reject transaction trying to spend already spent output', async () => {
      // Create initial block
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Spend the output
      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [{ address: 'addr2', value: 10 }],
      };
      const block2: Block = {
        id: createBlockId(2, [tx2]),
        height: 2,
        transactions: [tx2],
      };
      await IndexerService.processBlock(block2);

      // Try to spend it again
      const tx3: Transaction = {
        id: 'tx3',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [{ address: 'addr3', value: 10 }],
      };

      const result = await ValidationService.validateTransactionBalances([tx3]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Input references already spent output');
    });
  });
});

describe('IndexerService', () => {
  describe('processBlock', () => {
    test('should process block with coinbase transaction', async () => {
      const tx: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 50 }],
      };
      const block: Block = {
        id: createBlockId(1, [tx]),
        height: 1,
        transactions: [tx],
      };

      await IndexerService.processBlock(block);

      const balance = await IndexerService.getBalance('addr1');
      expect(balance).toBe(50);
    });

    test('should process block with multiple outputs', async () => {
      const tx: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [
          { address: 'addr1', value: 30 },
          { address: 'addr2', value: 20 },
        ],
      };
      const block: Block = {
        id: createBlockId(1, [tx]),
        height: 1,
        transactions: [tx],
      };

      await IndexerService.processBlock(block);

      expect(await IndexerService.getBalance('addr1')).toBe(30);
      expect(await IndexerService.getBalance('addr2')).toBe(20);
    });

    test('should process block with spending transaction', async () => {
      // Block 1: addr1 receives 10
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Block 2: addr1 spends to addr2 and addr3
      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [
          { address: 'addr2', value: 4 },
          { address: 'addr3', value: 6 },
        ],
      };
      const block2: Block = {
        id: createBlockId(2, [tx2]),
        height: 2,
        transactions: [tx2],
      };
      await IndexerService.processBlock(block2);

      expect(await IndexerService.getBalance('addr1')).toBe(0);
      expect(await IndexerService.getBalance('addr2')).toBe(4);
      expect(await IndexerService.getBalance('addr3')).toBe(6);
    });

    test('should handle complex multi-transaction block', async () => {
      // Initial block
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [
          { address: 'addr1', value: 100 },
          { address: 'addr2', value: 50 },
        ],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Block with multiple transactions
      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [
          { address: 'addr3', value: 60 },
          { address: 'addr4', value: 40 },
        ],
      };
      const tx3: Transaction = {
        id: 'tx3',
        inputs: [{ txId: 'tx1', index: 1 }],
        outputs: [{ address: 'addr5', value: 50 }],
      };
      const block2: Block = {
        id: createBlockId(2, [tx2, tx3]),
        height: 2,
        transactions: [tx2, tx3],
      };
      await IndexerService.processBlock(block2);

      expect(await IndexerService.getBalance('addr1')).toBe(0);
      expect(await IndexerService.getBalance('addr2')).toBe(0);
      expect(await IndexerService.getBalance('addr3')).toBe(60);
      expect(await IndexerService.getBalance('addr4')).toBe(40);
      expect(await IndexerService.getBalance('addr5')).toBe(50);
    });
  });

  describe('getBalance', () => {
    test('should return 0 for address with no transactions', async () => {
      const balance = await IndexerService.getBalance('nonexistent');
      expect(balance).toBe(0);
    });

    test('should return correct balance after transactions', async () => {
      const tx: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 100 }],
      };
      const block: Block = {
        id: createBlockId(1, [tx]),
        height: 1,
        transactions: [tx],
      };
      await IndexerService.processBlock(block);

      const balance = await IndexerService.getBalance('addr1');
      expect(balance).toBe(100);
    });
  });

  describe('rollbackToHeight', () => {
    test('should not rollback if target height is current height', async () => {
      const tx: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block: Block = {
        id: createBlockId(1, [tx]),
        height: 1,
        transactions: [tx],
      };
      await IndexerService.processBlock(block);

      const result = await IndexerService.rollbackToHeight(1);
      expect(result.success).toBe(true);
      expect(result.blocksRemoved).toBe(0);
      expect(await IndexerService.getBalance('addr1')).toBe(10);
    });

    test('should rollback single block', async () => {
      // Block 1
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 10 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      // Block 2
      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [{ address: 'addr2', value: 10 }],
      };
      const block2: Block = {
        id: createBlockId(2, [tx2]),
        height: 2,
        transactions: [tx2],
      };
      await IndexerService.processBlock(block2);

      // Rollback to height 1
      const result = await IndexerService.rollbackToHeight(1);
      expect(result.success).toBe(true);
      expect(result.blocksRemoved).toBe(1);
      expect(result.newHeight).toBe(1);

      // Check balances are restored
      expect(await IndexerService.getBalance('addr1')).toBe(10);
      expect(await IndexerService.getBalance('addr2')).toBe(0);

      // Check output is unspent
      const output = await prisma.output.findUnique({
        where: {
          transactionId_outputIndex: {
            transactionId: 'tx1',
            outputIndex: 0,
          },
        },
      });
      expect(output?.spent).toBe(false);
    });

    test('should rollback multiple blocks', async () => {
      // Build a chain of blocks
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 100 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      const tx2: Transaction = {
        id: 'tx2',
        inputs: [{ txId: 'tx1', index: 0 }],
        outputs: [{ address: 'addr2', value: 100 }],
      };
      const block2: Block = {
        id: createBlockId(2, [tx2]),
        height: 2,
        transactions: [tx2],
      };
      await IndexerService.processBlock(block2);

      const tx3: Transaction = {
        id: 'tx3',
        inputs: [{ txId: 'tx2', index: 0 }],
        outputs: [{ address: 'addr3', value: 100 }],
      };
      const block3: Block = {
        id: createBlockId(3, [tx3]),
        height: 3,
        transactions: [tx3],
      };
      await IndexerService.processBlock(block3);

      // Rollback to height 1
      const result = await IndexerService.rollbackToHeight(1);
      expect(result.success).toBe(true);
      expect(result.blocksRemoved).toBe(2);

      // Check balances
      expect(await IndexerService.getBalance('addr1')).toBe(100);
      expect(await IndexerService.getBalance('addr2')).toBe(0);
      expect(await IndexerService.getBalance('addr3')).toBe(0);
    });

    test('should rollback to height 0 (empty chain)', async () => {
      const tx1: Transaction = {
        id: 'tx1',
        inputs: [],
        outputs: [{ address: 'addr1', value: 50 }],
      };
      const block1: Block = {
        id: createBlockId(1, [tx1]),
        height: 1,
        transactions: [tx1],
      };
      await IndexerService.processBlock(block1);

      const result = await IndexerService.rollbackToHeight(0);
      expect(result.success).toBe(true);
      expect(result.blocksRemoved).toBe(1);
      expect(await IndexerService.getBalance('addr1')).toBe(0);

      // Check no blocks exist
      const blocks = await prisma.block.findMany();
      expect(blocks.length).toBe(0);
    });
  });
});

describe('Integration Tests - Full Flow', () => {
  test('should handle the example from README', async () => {
    // Block 1
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }],
    };
    const block1: Block = {
      id: createBlockId(1, [tx1]),
      height: 1,
      transactions: [tx1],
    };
    await IndexerService.processBlock(block1);
    expect(await IndexerService.getBalance('addr1')).toBe(10);

    // Block 2
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [
        { address: 'addr2', value: 4 },
        { address: 'addr3', value: 6 },
      ],
    };
    const block2: Block = {
      id: createBlockId(2, [tx2]),
      height: 2,
      transactions: [tx2],
    };
    await IndexerService.processBlock(block2);
    expect(await IndexerService.getBalance('addr1')).toBe(0);
    expect(await IndexerService.getBalance('addr2')).toBe(4);
    expect(await IndexerService.getBalance('addr3')).toBe(6);

    // Block 3
    const tx3: Transaction = {
      id: 'tx3',
      inputs: [{ txId: 'tx2', index: 1 }],
      outputs: [
        { address: 'addr4', value: 2 },
        { address: 'addr5', value: 2 },
        { address: 'addr6', value: 2 },
      ],
    };
    const block3: Block = {
      id: createBlockId(3, [tx3]),
      height: 3,
      transactions: [tx3],
    };
    await IndexerService.processBlock(block3);
    expect(await IndexerService.getBalance('addr1')).toBe(0);
    expect(await IndexerService.getBalance('addr2')).toBe(4);
    expect(await IndexerService.getBalance('addr3')).toBe(0);
    expect(await IndexerService.getBalance('addr4')).toBe(2);
    expect(await IndexerService.getBalance('addr5')).toBe(2);
    expect(await IndexerService.getBalance('addr6')).toBe(2);

    // Rollback to height 2
    await IndexerService.rollbackToHeight(2);
    expect(await IndexerService.getBalance('addr1')).toBe(0);
    expect(await IndexerService.getBalance('addr2')).toBe(4);
    expect(await IndexerService.getBalance('addr3')).toBe(6);
    expect(await IndexerService.getBalance('addr4')).toBe(0);
    expect(await IndexerService.getBalance('addr5')).toBe(0);
    expect(await IndexerService.getBalance('addr6')).toBe(0);
  });
});
