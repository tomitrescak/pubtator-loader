import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

export class FileProcessor {
  static isXmlFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return ext === '.xml';
  }

  static isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch (error) {
      return false;
    }
  }

  static isFile(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch (error) {
      return false;
    }
  }

  static getXmlFilesFromDirectory(dirPath: string): string[] {
    const files: string[] = [];
    
    try {
      const entries = readdirSync(dirPath);
      
      for (const entry of entries) {
        const fullPath = join(dirPath, entry);
        
        if (this.isFile(fullPath) && this.isXmlFile(fullPath)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      throw new Error(`Error reading directory ${dirPath}: ${(error as Error).message}`);
    }

    return files;
  }

  static getFilesToProcess(path: string): string[] {
    if (this.isFile(path)) {
      if (!this.isXmlFile(path)) {
        throw new Error(`File is not an XML file: ${path}`);
      }
      return [path];
    } else if (this.isDirectory(path)) {
      const files = this.getXmlFilesFromDirectory(path);
      if (files.length === 0) {
        throw new Error(`No XML files found in directory: ${path}`);
      }
      return files;
    } else {
      throw new Error(`Path does not exist or is not accessible: ${path}`);
    }
  }
}
