export interface InfonData {
    attributes: {
        key: string;
    }
    _text: string;
}

export interface LocationData {
    attributes: {
        offset: number;
        length: number;
    }
}

export interface AnnotationData {
    attributes: {
        id: string;
    }
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
