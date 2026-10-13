// Model sceny kompozycji. Plik SVG kompozycji jest źródłem prawdy; ten model jest jego
// roboczą postacią w pamięci. Serializacja (serialize.ts) i parsowanie (parse.ts) są
// wzajemnie odwrotne dla każdego modelu, który da się zbudować komendami (commands.ts).

/**
 * Transformacja węzła względem rodzica, w kolejności SVG:
 * translate(x y) rotate(rotation) skewX(skewX) scale(scaleX scaleY).
 * Obrót jest wokół lokalnego początku układu. Obrót „wokół środka” liczą komendy,
 * które przy okazji korygują x i y.
 */
export type Transform = {
  x: number;
  y: number;
  rotation: number; // stopnie
  skewX: number; // stopnie; powstaje tylko przy rozgrupowaniu obróconych i niejednorodnie skalowanych grup
  scaleX: number;
  scaleY: number;
};

type NodeBase = {
  id: string;
  name: string;
  transform: Transform;
  opacity: number; // 0..1
  hidden: boolean;
  locked: boolean;
};

/** Instancja grafiki z biblioteki. Treść jest kopią wklejoną do pliku kompozycji. */
export type AssetNode = NodeBase & {
  type: 'asset';
  assetId: string;
  assetVersion: number;
  width: number; // wymiary lokalnego prostokąta (0,0,width,height) przed skalowaniem
  height: number;
  /** Element <svg> z treścią grafiki; identyfikatory wewnątrz mają prefiks `${id}-`. */
  svg: string;
};

export type TextAnchor = 'start' | 'middle' | 'end';

export type TextNode = NodeBase & {
  type: 'text';
  text: string; // wiersze rozdzielone znakiem \n
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  fill: string;
  anchor: TextAnchor;
  lineHeight: number; // mnożnik rozmiaru fontu
};

export type GroupNode = NodeBase & {
  type: 'group';
  children: SceneNode[];
};

export const SHAPE_KINDS = ['rect', 'ellipse', 'polygon', 'star', 'line'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * Prymityw rysowany przez edytor. Kształt wypełnia lokalny prostokąt (0,0,width,height);
 * kwadrat i koło to prostokąt i elipsa o równych bokach.
 */
export type ShapeNode = NodeBase & {
  type: 'shape';
  shape: ShapeKind;
  width: number;
  height: number;
  /** null: bez wypełnienia. Linia nigdy nie ma wypełnienia. */
  fill: string | null;
  /** null: bez obrysu. */
  stroke: string | null;
  strokeWidth: number;
  /** Zaokrąglenie narożników prostokąta. */
  cornerRadius: number;
  /** Liczba boków wielokąta albo ramion gwiazdy. */
  sides: number;
  /** Stosunek promienia wewnętrznego do zewnętrznego gwiazdy (0–1). */
  innerRatio: number;
};

export type SceneNode = AssetNode | TextNode | GroupNode | ShapeNode;

export type Layer = {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  children: SceneNode[];
};

export type Scene = {
  width: number;
  height: number;
  /** Kolor tła płótna; null oznacza przezroczyste. */
  background: string | null;
  layers: Layer[]; // od spodu do wierzchu
};

/** Dane kompozycji zapisywane w pliku obok sceny: <title> i atrybuty elementu głównego. */
export type CompositionMeta = {
  name: string;
  author: 'human' | 'agent';
  status: 'draft' | 'reviewed';
};

export const IDENTITY: Transform = { x: 0, y: 0, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 };

export type Rect = { x: number; y: number; width: number; height: number };
