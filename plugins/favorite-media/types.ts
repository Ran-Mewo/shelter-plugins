export type MediaEntry = {
  url: string;
  src: string;
  width: number;
  height: number;
  format: number;
  isVideo?: boolean; // Internal type to check if Discord renders the media as a video (this includes YouTube embeds but does not include gifv)
  isEmbedGif?: boolean; // Internal type to check if the media is an embed gif
  name: string;
};

export type Message = {
  id: string;
  channel_id: string;
  attachments: Array<any>;
  embeds: Array<any>;
};

export type FavoriteGifEntry = {
  format: number; // 1 if the source is an actual image/gif. 2 if the source is a video.
  src: string; // The original URL of the media, the URL the user will send in chat when clicking on the gif
  url: string; // The URL used for rendering the media inside the picker
  width: number; // The width of the media
  height: number; // The height of the media
  order: number; // The order of the gif in the list
};

export type FavoriteGifsState = {
  gifs: Record<string, FavoriteGifEntry>;
  hideTooltip?: boolean;
};
