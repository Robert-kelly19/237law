import {
  LLMResponseCacheService,
  LLMSynthesisCacheValue,
} from './llm-response-cache.service';

describe('LLMResponseCacheService', () => {
  let service: LLMResponseCacheService;

  beforeEach(() => {
    service = new LLMResponseCacheService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('stores and returns defensive copies of cached responses', () => {
    const response: LLMSynthesisCacheValue = {
      answer: 'Initial answer',
      citations: ['Law, Article 1'],
      citedArticles: [
        {
          id: 'article-1',
          lawName: 'Law',
          articleNumber: '1',
        },
      ],
      toolsUsed: ['keyword_search'],
      relatedArticles: [{ id: 'related-1' }],
    };

    service.set('cache-key', response);

    response.answer = 'Mutated after set';
    response.citations.push('Law, Article 2');
    response.citedArticles[0].id = 'mutated';
    (response.relatedArticles[0] as { id: string }).id = 'mutated';

    const cached = service.get('cache-key');
    expect(cached).toEqual({
      answer: 'Initial answer',
      citations: ['Law, Article 1'],
      citedArticles: [
        {
          id: 'article-1',
          lawName: 'Law',
          articleNumber: '1',
        },
      ],
      toolsUsed: ['keyword_search'],
      relatedArticles: [{ id: 'related-1' }],
    });

    if (!cached) {
      throw new Error('Expected cached response');
    }

    cached.answer = 'Mutated after get';
    cached.citations.push('Law, Article 3');
    cached.citedArticles[0].id = 'mutated-again';
    (cached.relatedArticles[0] as { id: string }).id = 'mutated-again';

    expect(service.get('cache-key')).toEqual({
      answer: 'Initial answer',
      citations: ['Law, Article 1'],
      citedArticles: [
        {
          id: 'article-1',
          lawName: 'Law',
          articleNumber: '1',
        },
      ],
      toolsUsed: ['keyword_search'],
      relatedArticles: [{ id: 'related-1' }],
    });
  });
});
