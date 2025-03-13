import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock repository before importing the service
const mockGetConversationByZid = jest.fn();
const mockGetConversationByConversationId = jest.fn();
const mockGetZidFromConversationId = jest.fn();

jest.unstable_mockModule('../../src/repositories/conversation/conversationRepository.js', () => ({
  __esModule: true,
  getConversationByZid: mockGetConversationByZid,
  getConversationByConversationId: mockGetConversationByConversationId,
  getZidFromConversationId: mockGetZidFromConversationId
}));

// Import the service after mocking the repository
const conversationService = await import('../../src/services/conversation/conversationService.js');

describe('Conversation Service', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getConversationInfo', () => {
    it('should return conversation info when valid zid is provided', async () => {
      // Mock data
      const mockZid = 123;
      const mockConversation = {
        zid: mockZid,
        topic: 'Test Topic',
        description: 'Test Description',
        owner: 456
      };

      // Setup mock implementation
      mockGetConversationByZid.mockResolvedValue(mockConversation);

      // Call the function
      const result = await conversationService.getConversationInfo(mockZid);

      // Assertions
      expect(mockGetConversationByZid).toHaveBeenCalledWith(mockZid);
      expect(result).toEqual(mockConversation);
    });

    it('should throw an error when repository call fails', async () => {
      // Mock data
      const mockZid = 123;
      const mockError = new Error('Database error');

      // Setup mock implementation
      mockGetConversationByZid.mockRejectedValue(mockError);

      // Call the function and expect it to throw
      await expect(conversationService.getConversationInfo(mockZid)).rejects.toThrow(mockError);
      expect(mockGetConversationByZid).toHaveBeenCalledWith(mockZid);
    });
  });

  describe('getConversationInfoByConversationId', () => {
    it('should return conversation info when valid conversation ID is provided', async () => {
      // Mock data
      const mockConversationId = 'abc123';
      const mockConversation = {
        zid: 123,
        topic: 'Test Topic',
        description: 'Test Description',
        owner: 456
      };

      // Setup mock implementation
      mockGetConversationByConversationId.mockResolvedValue(mockConversation);

      // Call the function
      const result = await conversationService.getConversationInfoByConversationId(mockConversationId);

      // Assertions
      expect(mockGetConversationByConversationId).toHaveBeenCalledWith(mockConversationId);
      expect(result).toEqual(mockConversation);
    });

    it('should throw an error when repository call fails', async () => {
      // Mock data
      const mockConversationId = 'abc123';
      const mockError = new Error('Database error');

      // Setup mock implementation
      mockGetConversationByConversationId.mockRejectedValue(mockError);

      // Call the function and expect it to throw
      await expect(conversationService.getConversationInfoByConversationId(mockConversationId)).rejects.toThrow(
        mockError
      );
      expect(mockGetConversationByConversationId).toHaveBeenCalledWith(mockConversationId);
    });
  });

  describe('getZidFromConversationId', () => {
    it('should return zid when valid conversation ID is provided', async () => {
      // Mock data
      const mockConversationId = 'abc123';
      const mockZid = 123;

      // Setup mock implementation
      mockGetZidFromConversationId.mockResolvedValue(mockZid);

      // Call the function
      const result = await conversationService.getZidFromConversationId(mockConversationId);

      // Assertions
      expect(mockGetZidFromConversationId).toHaveBeenCalledWith(mockConversationId);
      expect(result).toEqual(mockZid);
    });

    it('should throw an error when repository call fails', async () => {
      // Mock data
      const mockConversationId = 'abc123';
      const mockError = new Error('Database error');

      // Setup mock implementation
      mockGetZidFromConversationId.mockRejectedValue(mockError);

      // Call the function and expect it to throw
      await expect(conversationService.getZidFromConversationId(mockConversationId)).rejects.toThrow(mockError);
      expect(mockGetZidFromConversationId).toHaveBeenCalledWith(mockConversationId);
    });
  });
});
