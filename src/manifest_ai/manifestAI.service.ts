import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
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

  async getAnswer(
    prompt: string,
    files: Express.Multer.File[],
    language: 'en' | 'pl',
  ) {
    const { LlamaContext, LlamaChatSession, LlamaModel } = await import(
      'node-llama-cpp'
    );
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
    const finalPrompt = prompt.includes('[INST]')
        ? `${prompt.replace('{similaritySearchResult}', `EXTRA INFORMATION: ${usefulInfo}`)} EXTRA INFO: ${usefulInfo}`
        : language === 'en'
          ? `<s>[INST]use this extra information to help user with his task[/INST] EXTRA INFORMATION: ${usefulInfo}</s>TASK: ${prompt}`
          : //? `<s>[INST]use this database scheme to generate SQL request to get valid data for answer question[/INST]SCHEME:${scheme}</s>QUESTION:${prompt}[INST]give only sql request in your answer[/INST]`
          `<s>[INST]użyj tych dodatkowych informacji, aby pomóc użytkownikowi w jego zadaniu[/INST] DODATKOWE INFORMACJE: ${usefulInfo}</s>ZADANIE: ${prompt}[INST]odpowiedz po polsku[/INST]`
      //`[INST]zbierz wszystkie uwaga ostrzegawcze[/INST] DODATKOWE INFORMACJE: ${usefulInfo}, ZADANIE: ${prompt}[INST]odpowiedz tylko po polsku[/INST]`,

    const vectors = context.encode(finalPrompt + '[INST]Your answer is limited in 1000 words [/INST]')

    const answer = [];
    for await (const val of context.evaluate(vectors, {
      temperature: 0.4,
      topP: 0.45,
      topK: 40,
    })) {
      answer.push(val)
      if (answer.length > 3072) {
        break
      }
    }
    const decodedAnswer = await context.decode(answer)
    return decodedAnswer;
  }
}
