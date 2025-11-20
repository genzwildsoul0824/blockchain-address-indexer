import { createHash } from 'crypto';
import type { Block, Transaction, Input } from '../types';
import { prisma } from '../lib/prisma';

export class ValidationService {
  /**
   * Validate block height is exactly one unit higher than current height
   */
  static async validateHeight(height: number): Promise<{ valid: boolean; error?: string }> {
    const latestBlock = await prisma.block.findFirst({
      orderBy: { height: 'desc' },
      select: { height: true },
    });

    const expectedHeight = latestBlock ? latestBlock.height + 1 : 1;

    if (height !== expectedHeight) {
      return {
        valid: false,
        error: `Invalid block height. Expected ${expectedHeight}, got ${height}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate block ID matches sha256(height + tx1.id + tx2.id + ...)
   */
  static validateBlockId(block: Block): { valid: boolean; error?: string } {
    const concatenated = block.height + block.transactions.map(tx => tx.id).join('');
    const expectedId = createHash('sha256').update(concatenated).digest('hex');

    if (block.id !== expectedId) {
      return {
        valid: false,
        error: `Invalid block ID. Expected ${expectedId}, got ${block.id}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate sum of inputs equals sum of outputs for each transaction
   */
  static async validateTransactionBalances(
    transactions: Transaction[]
  ): Promise<{ valid: boolean; error?: string }> {
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      const outputSum = tx.outputs.reduce((sum, output) => sum + output.value, 0);

      // Coinbase transaction (no inputs) - only allowed as first transaction
      if (tx.inputs.length === 0) {
        if (i !== 0) {
          return {
            valid: false,
            error: `Transaction ${tx.id}: Coinbase transaction (no inputs) only allowed as first transaction in block`,
          };
        }
        continue;
      }

      let inputSum = 0;
      for (const input of tx.inputs) {
        const output = await prisma.output.findUnique({
          where: {
            transactionId_outputIndex: {
              transactionId: input.txId,
              outputIndex: input.index,
            },
          },
        });

        if (!output) {
          return {
            valid: false,
            error: `Transaction ${tx.id}: Input references non-existent output (txId: ${input.txId}, index: ${input.index})`,
          };
        }

        if (output.spent) {
          return {
            valid: false,
            error: `Transaction ${tx.id}: Input references already spent output (txId: ${input.txId}, index: ${input.index})`,
          };
        }

        inputSum += Number(output.value);
      }

      if (inputSum !== outputSum) {
        return {
          valid: false,
          error: `Transaction ${tx.id}: Input sum (${inputSum}) does not equal output sum (${outputSum})`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate entire block
   */
  static async validateBlock(block: Block): Promise<{ valid: boolean; error?: string }> {
    const heightValidation = await this.validateHeight(block.height);
    if (!heightValidation.valid) {
      return heightValidation;
    }

    const idValidation = this.validateBlockId(block);
    if (!idValidation.valid) {
      return idValidation;
    }

    const balanceValidation = await this.validateTransactionBalances(block.transactions);
    if (!balanceValidation.valid) {
      return balanceValidation;
    }

    return { valid: true };
  }
}

