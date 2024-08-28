import {
  HttpException,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';
import * as fs from 'fs';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';

@Injectable()
export class ManifestAIService implements OnApplicationBootstrap {
  documents;
  embeddingModel = new HuggingFaceTransformersEmbeddings();
  manifestAIBasePath = `./src/docker-volume/`;
  vectorStore: FaissStore;
  async onApplicationBootstrap() {
    if (!fs.existsSync(`${this.manifestAIBasePath}uploads/ManifestAI`)) {
      fs.mkdirSync(`${this.manifestAIBasePath}uploads/ManifestAI`);
    }
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
        if (file.originalname.toLowerCase().includes('.pdf')) {
          fileLoader = new PDFLoader(filePath);
        }
        if (file.originalname.toLowerCase().includes('.txt')) {
          fileLoader = new TextLoader(filePath);
        }
        if (file.originalname.toLowerCase().includes('.docx')) {
          fileLoader = new DocxLoader(filePath);
        }
        if (file.originalname.toLowerCase().includes('.csc')) {
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

  async getAnswer({
    prompt,
    files,
    text,
    language,
  }: {
    prompt: string;
    files?: Express.Multer.File[];
    text?: string;
    language?: 'en' | 'pl';
  }) {
    if (!prompt) {
      throw new HttpException('Prompt is empty', 400);
    }
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
      chunkSize: 700,
      chunkOverlap: 0,
    });
    if (files) {
      await this.processFile(files, textSplitter);
    }
    if (text) {
      console.log(text);
      const filePath = `${this.manifestAIBasePath}uploads/ManifestAI/files/audioNote${Date.now()}.txt`;
      fs.writeFileSync(filePath, text);
      const tempVectors = await FaissStore.fromTexts(
        [text],
        {},
        this.embeddingModel,
      );
      if (this.vectorStore) {
        await this.vectorStore.mergeFrom(tempVectors);
      } else {
        this.vectorStore = tempVectors;
      }
    }
    const relevantDocs = await this.vectorStore.similaritySearch(prompt, 10);
    const usefulText = relevantDocs.map((el) => el.pageContent);
    const usefulInfo = [
      ...new Set(usefulText.filter((el) => el.length > 20)),
    ].join();
    const finalPrompt = prompt.includes('[INST]')
      ? `${prompt.replace('{similaritySearchResult}', `EXTRA INFORMATION: ${usefulInfo}`)} EXTRA INFO: ${usefulInfo}`
      : language !== 'pl'
        ? `<s>[INST]use this extra information to answer user's question[/INST] EXTRA INFORMATION: ${usefulInfo}</s>QUESTION: ${prompt}`
        : `[INST]użyj tych dodatkowych informacji, udziel krótkiej odpowiedzi na następujące pytanie ${usefulInfo}[/INST]${prompt}?[INST]odpowiedz po polsku[/INST]`;

    const vectors = context.encode(finalPrompt);

    const answer = [];
    for await (const val of context.evaluate(vectors, {
      temperature: 0.4,
      topP: 0.45,
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
