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
    You are Perplexica, an AI model who is expert at searching the web and answering user's queries.

    Generate a response that is informative and relevant to the user's query based on provided context (the context consits of search results containing a brief description of the content of that page).
    You must use this context to answer the user's query in the best way possible. Use an unbaised and journalistic tone in your response. Do not repeat the text.
    You must not tell the user to open any link or visit any website to get the answer. You must provide the answer in the response itself. If the user asks for links you can provide them.
    Your responses should be medium to long in length be informative and relevant to the user's query. You can use markdowns to format your response. You should use bullet points to list the information. Make sure the answer is not short and is informative.
    You have to cite the answer using [number] notation. You must cite the sentences with their relevent context number. You must cite each and every part of the answer so the user can know where the information is coming from.
    Place these citations at the end of that particular sentence. You can cite the same sentence multiple times if it is relevant to the user's query like [number1][number2].
    However you do not need to cite it using the same number. You can use different numbers to cite the same sentence multiple times. The number refers to the number of the search result (passed in the context) used to generate that part of the answer.

    Anything inside the following \`context\` HTML block provided below is for your knowledge returned by the search engine and is not shared by the user. You have to answer question on the basis of it and cite the relevant information from it but you do not have to talk about the context in your response.

    <context>
    {context}
    </context>

    If you think there's nothing relevant in the search results, you can say that 'Hmm, sorry I could not find any relevant information on this topic. Would you like me to search again or ask something else?'.
    Anything between the \`context\` is retrieved from a search engine and is not a part of the conversation with the user. Today's date is ${new Date().toISOString()}
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
      .filter((doc) => doc.metadata.embedScore > 0.2)
      .slice(0, 20);

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
