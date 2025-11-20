// Type definitions matching the README schema

export interface Output {
  address: string;
  value: number;
}

export interface Input {
  txId: string;
  index: number;
}

export interface Transaction {
  id: string;
  inputs: Input[];
  outputs: Output[];
}

export interface Block {
  id: string;
  height: number;
  transactions: Transaction[];
}

export interface BlockResponse {
  success: boolean;
  message?: string;
  block?: {
    id: string;
    height: number;
    transactionsCount: number;
  };
}

export interface BalanceResponse {
  address: string;
  balance: number;
}

export interface RollbackResponse {
  success: boolean;
  message: string;
  newHeight: number;
  blocksRemoved: number;
}

