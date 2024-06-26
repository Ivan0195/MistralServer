import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';
import * as fs from 'fs';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { from } from "rxjs";

@Injectable()
export class ManifestAIService implements OnApplicationBootstrap {
  model;
  context;
  chatSession;
  textSplitter;
  documents;
  embeddingModel = new HuggingFaceTransformersEmbeddings();
  manifestAIBasePath = `./src/docker-volume/`;
  vectorStore: FaissStore;
  async onApplicationBootstrap() {
    if (!fs.existsSync(`${this.manifestAIBasePath}uploads/ManifestAI`)) {
      fs.mkdirSync(`${this.manifestAIBasePath}uploads/ManifestAI`);
    }
  }

  async processFile(files: Express.Multer.File[]) {
    for (const file of files) {
      console.log(file.originalname)
      const index = files.indexOf(file)
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
        const splittedDocs = await this.textSplitter.splitDocuments(documents);
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
    const { LlamaModel, LlamaContext, LlamaChatSession } = await import(
      'node-llama-cpp'
      );
    this.model = new LlamaModel({
      modelPath: './src/shared/Mistral-7B-Instruct-v0.2.Q3_K_S.gguf',
      temperature: 0.4,
      seed: 1,
      topP: 0.45,
      topK: 40,
    });
    this.context = new LlamaContext({
      model: this.model,
      contextSize: 32000,
      batchSize: 32000,
    });
    this.chatSession = new LlamaChatSession({ context: this.context });

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 200,
      chunkOverlap: 0,
    });
    await this.processFile(files);
    const relevantDocs = await this.vectorStore.similaritySearch(prompt, 150);
    const usefulText = relevantDocs.map((el) => el.pageContent);
    const usefulInfo = [
      ...new Set(usefulText.filter((el) => el.length > 20)),
    ].join();
    const answer = await this.chatSession.prompt(
      prompt.includes('[INST]')
        ? `${prompt.replace('{similaritySearchResult}', `EXTRA INFORMATION: ${usefulInfo}`)} EXTRA INFO: ${usefulInfo}`
        : language === 'en'
        ? `<s>[INST]use this extra information to help user with his task[/INST] EXTRA INFORMATION: ${usefulInfo}</s>TASK: ${prompt}`
        //? `<s>[INST]use this database scheme to generate SQL request to get valid data for answer question[/INST]SCHEME:${scheme}</s>QUESTION:${prompt}[INST]give only sql request in your answer[/INST]`
        : `<s>[INST]użyj tych dodatkowych informacji, aby pomóc użytkownikowi w jego zadaniu[/INST] DODATKOWE INFORMACJE: ${usefulInfo}</s>ZADANIE: ${prompt}[INST]odpowiedz po polsku[/INST]`,
      //`[INST]zbierz wszystkie uwaga ostrzegawcze[/INST] DODATKOWE INFORMACJE: ${usefulInfo}, ZADANIE: ${prompt}[INST]odpowiedz tylko po polsku[/INST]`,
    );
    console.log(answer);
    return answer;
  }
}
