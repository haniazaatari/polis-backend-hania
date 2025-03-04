import { Response } from "express";
import DynamoStorageService from "../../utils/storage";

export interface PolisRecord {
  [key: string]: string; // Allow any string keys
}

export interface CommentCoverageMetrics {
  totalComments: number;
  filteredComments: number;
  citedComments: number;
  omittedComments: number;
}

export interface QueryParams {
  [key: string]: string | string[] | undefined;
}

export interface FilterFunction {
  (v: {
    votes?: number;
    agrees?: number;
    disagrees?: number;
    passes?: number;
    group_aware_consensus?: number;
    comment_extremity?: number;
    comment_id: number;
    num_groups?: number;
  }): boolean;
}

export interface Section {
  name: string;
  templatePath: string;
  filter: FilterFunction;
}

export interface SectionHandlerParams {
  rid: string;
  storage: DynamoStorageService | undefined;
  res: Response;
  model: string;
  system_lore: string;
  zid: number;
  modelVersion?: string;
  totalComments?: number;
}
