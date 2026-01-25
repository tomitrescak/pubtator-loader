export interface InfonData {
  '@_key': string;
  '#text': string;
}

export interface LocationData {
  '@_offset': number;
  '@_length': number;
}

export interface AnnotationData {
  '@_id': string;
  infon?: InfonData[];
  location?: LocationData[];
  text?: string;
}

export interface PassageData {
  infon?: InfonData[];
  offset?: number;
  text?: string;
  annotation?: AnnotationData[];
}

export interface DocumentData {
  id?: string;
  passage?: PassageData[];
}

export interface CollectionData {
  source?: string;
  date?: string;
  key?: string;
  document?: DocumentData[];
}

export interface BiocXmlData {
  collection?: CollectionData;
}
