import type { Block } from '../types';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

export class IndexerService {
  /**
   * Process and store a block with all its transactions
   * Updates address balances based on UTXO model
   */
  static async processBlock(block: Block) {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create block and transactions
      const createdBlock = await tx.block.create({
        data: {
          id: block.id,
          height: block.height,
          transactions: {
            create: block.transactions.map((transaction) => ({
              id: transaction.id,
              inputs: {
                create: transaction.inputs.map((input) => ({
                  txId: input.txId,
                  outputIndex: input.index,
                })),
              },
              outputs: {
                create: transaction.outputs.map((output, index) => ({
                  address: output.address,
                  value: BigInt(output.value),
                  outputIndex: index,
                  spent: false,
                })),
              },
            })),
          },
        },
        include: {
          transactions: {
            include: {
              inputs: true,
              outputs: true,
            },
          },
        },
      });

      // Process each transaction to update balances
      for (const transaction of block.transactions) {
        // Mark inputs as spent and decrease balances
        for (const input of transaction.inputs) {
          const output = await tx.output.findUnique({
            where: {
              transactionId_outputIndex: {
                transactionId: input.txId,
                outputIndex: input.index,
              },
            },
          });

          if (output) {
            // Mark output as spent
            await tx.output.update({
              where: { id: output.id },
              data: { spent: true },
            });

            // Decrease balance for the address
            await tx.addressBalance.upsert({
              where: { address: output.address },
              update: {
                balance: {
                  decrement: output.value,
                },
              },
              create: {
                address: output.address,
                balance: -output.value,
              },
            });
          }
        }

        // Increase balances for outputs
        for (const output of transaction.outputs) {
          await tx.addressBalance.upsert({
            where: { address: output.address },
            update: {
              balance: {
                increment: BigInt(output.value),
              },
            },
            create: {
              address: output.address,
              balance: BigInt(output.value),
            },
          });
        }
      }

      return createdBlock;
    });
  }

  /**
   * Get balance for an address
   */
  static async getBalance(address: string): Promise<number> {
    const balance = await prisma.addressBalance.findUnique({
      where: { address },
    });

    return balance ? Number(balance.balance) : 0;
  }

  /**
   * Rollback to a specific height
   * Removes all blocks after the target height and recalculates balances
   */
  static async rollbackToHeight(targetHeight: number) {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Get current height
      const latestBlock = await tx.block.findFirst({
        orderBy: { height: 'desc' },
        select: { height: true },
      });

      const currentHeight = latestBlock?.height ?? 0;

      if (targetHeight >= currentHeight) {
        return {
          success: true,
          message: 'No rollback needed',
          newHeight: currentHeight,
          blocksRemoved: 0,
        };
      }

      // Get all blocks to be removed (in reverse order)
      const blocksToRemove = await tx.block.findMany({
        where: {
          height: {
            gt: targetHeight,
          },
        },
        include: {
          transactions: {
            include: {
              inputs: true,
              outputs: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: {
          height: 'desc',
        },
      });

      // Reverse all balance changes
      for (const block of blocksToRemove) {
        // Process transactions in reverse order
        const reversedTransactions = [...block.transactions].reverse();

        for (const transaction of reversedTransactions) {
          for (const output of transaction.outputs) {
            await tx.addressBalance.upsert({
              where: { address: output.address },
              update: {
                balance: {
                  decrement: output.value,
                },
              },
              create: {
                address: output.address,
                balance: -output.value,
              },
            });
          }

          // Reverse inputs (unspend outputs and increase balances)
          for (const input of transaction.inputs) {
            const output = await tx.output.findUnique({
              where: {
                transactionId_outputIndex: {
                  transactionId: input.txId,
                  outputIndex: input.outputIndex,
                },
              },
            });

            if (output) {
              // Mark output as unspent
              await tx.output.update({
                where: { id: output.id },
                data: { spent: false },
              });

              // Increase balance back
              await tx.addressBalance.upsert({
                where: { address: output.address },
                update: {
                  balance: {
                    increment: output.value,
                  },
                },
                create: {
                  address: output.address,
                  balance: output.value,
                },
              });
            }
          }
        }
      }

      // Delete blocks (cascade will delete transactions, inputs, outputs)
      await tx.block.deleteMany({
        where: {
          height: {
            gt: targetHeight,
          },
        },
      });

      return {
        success: true,
        message: `Rolled back from height ${currentHeight} to ${targetHeight}`,
        newHeight: targetHeight,
        blocksRemoved: blocksToRemove.length,
      };
    });
  }
}

