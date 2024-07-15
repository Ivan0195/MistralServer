import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';

@Injectable()
export class ManifestMakerService {
  documents;
  embeddingModel = new HuggingFaceTransformersEmbeddings();
  manifestAIBasePath = `./src/docker-volume/`;
  grammarBasePath = `./src/manifest-maker/shared/`;
  vectorStore: FaissStore;

  async generateSteps(subtitles: string, withDescription: boolean) {
    const {
      LlamaContext,
      LlamaModel,
      LlamaGrammar,
      LlamaGrammarEvaluationState,
    } = await import('node-llama-cpp');

    const myGrammar = fs.readFileSync(
      `${this.grammarBasePath}${withDescription ? 'stepsWithDescription.gbnf' : 'steps.gbnf'}`,
      'utf-8',
    );

    const model = new LlamaModel({
      modelPath: './src/shared/Mistral-7B-Instruct-v0.2.Q3_K_S.gguf',
      gpuLayers: 999,
      seed: 1,
    });

    const grammar = new LlamaGrammar({ grammar: myGrammar });

    const context = new LlamaContext({
      model: model,
      contextSize: 8192,
      batchSize: 16384,
      grammar,
    });
    const vectors = context.encode(`[INST]generate manual[/INST]${subtitles}`);

    const answer = [];
    for await (const val of context.evaluate(vectors, {
      temperature: 0.8,
      topP: 0.95,
      topK: 40,
      grammarEvaluationState: new LlamaGrammarEvaluationState({
        grammar: grammar,
      }),
    })) {
      answer.push(val);
      if (answer.length > 3072) {
        break;
      }
    }
    const decodedAnswer = await context.decode(answer);
    return decodedAnswer;
  }

  async processFile(
    files: Express.Multer.File[],
    textSplitter: RecursiveCharacterTextSplitter,
  ) {
    for (const file of files) {
      console.log(file.originalname);
      const index = files.indexOf(file);
      if (
        fs.existsSync(
          `${this.manifestAIBasePath}uploads/ManifestAI/files/${file.originalname}`,
        )
      ) {
        console.log('file exists');
        const tempVectorStore = await FaissStore.load(
          `${this.manifestAIBasePath}uploads/ManifestAI/faiss-saved-stores/${file.originalname}`,
          this.embeddingModel,
        );
        if (!index) {
          this.vectorStore = tempVectorStore;
        } else {
          await this.vectorStore.mergeFrom(tempVectorStore);
        }
      } else {
        const filePath = `${this.manifestAIBasePath}uploads/ManifestAI/files/${file.originalname}`;
        fs.writeFileSync(filePath, file.buffer);
        let fileLoader: PDFLoader | CSVLoader | TextLoader | DocxLoader;
        if (file.originalname.includes('.pdf')) {
          fileLoader = new PDFLoader(filePath);
        }
        if (file.originalname.includes('.txt')) {
          fileLoader = new TextLoader(filePath);
        }
        if (file.originalname.includes('.docx')) {
          fileLoader = new DocxLoader(filePath);
        }
        if (file.originalname.includes('.csc')) {
          fileLoader = new CSVLoader(filePath);
        }
        const documents = await fileLoader.load();
        const splittedDocs = await textSplitter.splitDocuments(documents);
        this.documents = splittedDocs;
        const fileVectorFormat = await FaissStore.fromDocuments(
          splittedDocs,
          this.embeddingModel,
        );
        if (index) {
          await this.vectorStore.mergeFrom(fileVectorFormat);
        } else {
          this.vectorStore = fileVectorFormat;
        }
        await fileVectorFormat.save(
          `${this.manifestAIBasePath}uploads/ManifestAI/faiss-saved-stores/${file.originalname}`,
        );
      }
    }
  }

  async generateKeyboardVocabulary(
    prompt: string,
    files: Express.Multer.File[],
  ) {
    const { LlamaContext, LlamaModel } = await import('node-llama-cpp');
    const model = new LlamaModel({
      modelPath: './src/shared/Mistral-7B-Instruct-v0.2.Q3_K_S.gguf',
      gpuLayers: 999,
      seed: 1,
    });
    const context = new LlamaContext({
      model: model,
      contextSize: 8192,
      batchSize: 16384,
    });
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 200,
      chunkOverlap: 0,
    });
    await this.processFile(files, textSplitter);
    const relevantDocs = await this.vectorStore.similaritySearch(prompt, 150);
    const usefulText = relevantDocs.map((el) => el.pageContent);
    const usefulInfo = [
      ...new Set(usefulText.filter((el) => el.length > 20)),
    ].join();

    const vectors = context.encode(
      `<s>[INST]You are AI assistant, your name is Taqi. Answer questions. Use this helpful information to answer questions.  Finish your answer with <end> tag.[/INST] ${usefulInfo}</s>[INST]${prompt}[/INST]`,
    );

    const answer = [];
    for await (const val of context.evaluate(vectors, {
      temperature: 0.8,
      topP: 0.95,
      topK: 40,
    })) {
      answer.push(val);
      if (answer.length > 3072) {
        break;
      }
    }
    const decodedAnswer = await context.decode(answer);
    return decodedAnswer;
  }
}
