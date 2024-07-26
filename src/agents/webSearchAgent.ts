import { BaseMessage } from '@langchain/core/messages';
import {
  PromptTemplate,
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  RunnableSequence,
  RunnableMap,
  RunnableLambda,
} from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import formatChatHistoryAsString from '../utils/formatHistory';
import eventEmitter from 'events';
import logger from '../utils/logger';
import { searchWeaviate } from '../lib/weaviate';

const basicSearchRetrieverPrompt = `
You are tasked with rephrasing a follow-up question to optimize it for a web search and subsequent reranking in a RAG application using Cohere. Your goal is to create a query in question format that will yield the most relevant results when used with Cohere's embedding and reranking models.

Guidelines for rephrasing:
1. Always phrase the query as a clear, concise question.
2. Focus on key concepts and entities within the question.
3. Use specific, descriptive terms rather than general ones.
4. Include important context from the conversation history.
5. Avoid personal pronouns and conversational language.
6. Use natural language phrasing that matches how information is likely to be written in authoritative sources.
7. For complex questions, consider breaking them down into simpler, more focused questions.
8. If the input is a writing task or a simple greeting (e.g., "hi", "hello"), return "not_needed".

Examples:
1. Follow up question: What's the capital of France and how many people live there?
Rephrased: What is the population of Paris, the capital of France?

2. Follow up question: Can you tell me about the history and features of Docker?
Rephrased: What are the key historical milestones and main features of Docker containerization technology?

3. Follow up question: How does climate change affect polar bear populations?
Rephrased: How is climate change impacting Arctic polar bear habitats and population trends?

4. Follow up question: Write a poem about spring.
Rephrased: not_needed

Conversation:
{chat_history}

Follow up question: {query}
Rephrased question:
`;

const basicWebSearchResponsePrompt = `
    You are Perplexica, an AI model expert at web searching and answering user queries.

    Generate an informative and relevant response based on the provided context. Use an unbiased, tone similar to Paul Graham. Do not repeat the text verbatim.

    Your responses long, using markdown formatting and bullet points where appropriate. Ensure the answer is comprehensive and informative.

    Cite your sources using [number] notation at the end of each relevant sentence. Include brief, relevant excerpts from the context in quotation marks, followed by the citation. For example: "Key information from the source" [number].

    Keep excerpts concise, focusing on the essence of the information. You may paraphrase to maintain brevity while capturing the main points.

    If multiple sources support a statement, you can cite them together: [number1][number2].

    The context is provided within the following HTML block and is not shared by the user:

    <context>
    {context}
    </context>

    If no relevant information is found, respond with: 'I couldn't find any relevant information on this topic. Would you like me to search again or ask something else?'

    The context is retrieved from a search engine and is not part of the user conversation.
`;

const strParser = new StringOutputParser();

const handleStream = async (
  stream: AsyncGenerator<StreamEvent, any, unknown>,
  emitter: eventEmitter,
) => {
  for await (const event of stream) {
    if (
      event.event === 'on_chain_end' &&
      event.name === 'FinalSourceRetriever'
    ) {
      emitter.emit(
        'data',
        JSON.stringify({ type: 'sources', data: event.data.output }),
      );
    }
    if (
      event.event === 'on_chain_stream' &&
      event.name === 'FinalResponseGenerator'
    ) {
      emitter.emit(
        'data',
        JSON.stringify({ type: 'response', data: event.data.chunk }),
      );
    }
    if (
      event.event === 'on_chain_end' &&
      event.name === 'FinalResponseGenerator'
    ) {
      emitter.emit('end');
    }
  }
};

type BasicChainInput = {
  chat_history: BaseMessage[];
  query: string;
};

const createBasicWebSearchRetrieverChain = (llm: BaseChatModel) => {
  return RunnableSequence.from([
    PromptTemplate.fromTemplate(basicSearchRetrieverPrompt),
    llm,
    strParser,
    RunnableLambda.from(async (input: string) => {
      logger.info(`Processing retriever input: ${input}`);
      if (input === 'not_needed') {
        logger.info('Search not needed, returning empty result');
        return { query: '', docs: [] };
      }

      logger.info(`Performing Weaviate search for: ${input}`);
      const { results } = await searchWeaviate(input);

      const documents = results.map(
        (result) =>
          new Document({
            pageContent: result.content,
            metadata: {
              title: result.title,
              url: result.url,
              embedScore: result.embedScore,
              rerankScore: result.rerankScore,
            },
          })
      );
      logger.info(`Retrieved ${documents.length} documents from Weaviate`);

      return { query: input, docs: documents };
    }),
  ]);
};


const createBasicWebSearchAnsweringChain = (
  llm: BaseChatModel,
) => {
  const basicWebSearchRetrieverChain = createBasicWebSearchRetrieverChain(llm);

  const processDocs = async (docs: Document[]) => {
    return docs
      .map((_, index) => `${index + 1}. ${docs[index].pageContent}`)
      .join('\n');
  };

  const rerankDocs = async ({
    docs,
  }: {
    docs: Document[];
  }) => {
    if (docs.length === 0) {
      return docs;
    }

    const docsWithContent = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.length > 0,
    );

    const sortedDocs = docsWithContent
      .sort((a, b) => b.metadata.rerankScore - a.metadata.rerankScore)
      .filter((doc) => doc.metadata.embedScore > 0.3)
      .slice(0, 5);

    logger.info(`Reranked and filtered to ${sortedDocs.length} documents`);
    return sortedDocs;
  };

  return RunnableSequence.from([
    RunnableMap.from({
      query: (input: BasicChainInput) => input.query,
      chat_history: (input: BasicChainInput) => input.chat_history,
      context: RunnableSequence.from([
        (input) => ({
          query: input.query,
          chat_history: formatChatHistoryAsString(input.chat_history),
        }),
        basicWebSearchRetrieverChain
          .pipe(rerankDocs)
          .withConfig({
            runName: 'FinalSourceRetriever',
          })
          .pipe(processDocs),
      ]),
    }),
    ChatPromptTemplate.fromMessages([
      ['system', basicWebSearchResponsePrompt],
      new MessagesPlaceholder('chat_history'),
      ['user', '{query}'],
    ]),
    llm,
    strParser,
  ]).withConfig({
    runName: 'FinalResponseGenerator',
  });
};

const basicWebSearch = (
  query: string,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
) => {
  const emitter = new eventEmitter();

  try {
    const basicWebSearchAnsweringChain = createBasicWebSearchAnsweringChain(
      llm,
    );

    const stream = basicWebSearchAnsweringChain.streamEvents(
      {
        chat_history: history,
        query: query,
      },
      {
        version: 'v1',
      },
    );

    handleStream(stream, emitter);
  } catch (err) {
    emitter.emit(
      'error',
      JSON.stringify({ data: 'An error has occurred please try again later' }),
    );
    logger.error(`Error in websearch: ${err}`);
  }

  return emitter;
};

const handleWebSearch = (
  message: string,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
) => {
  const emitter = basicWebSearch(message, history, llm, embeddings);
  return emitter;
};

export default handleWebSearch;
