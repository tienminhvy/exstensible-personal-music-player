// YouTube ids are exactly 11 chars of [A-Za-z0-9_-]; validating here also
// keeps the id safe to embed in the media filename.
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
