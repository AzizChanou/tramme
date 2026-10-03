// H.264 in MP4 the way every player reads it, for the encoders of the
// browser exports and of the cut-out masks.

/** a packet in Annex B (start codes), rather than with its NAL units prefixed by their length */
const isAnnexB = (d: Uint8Array) => d[0] === 0 && d[1] === 0 && (d[2] === 1 || (d[2] === 0 && d[3] === 1));

/**
 * H.264 in an MP4: the encoder hands its frames in Annex B, with the parameter
 * sets in band, and the muxer writes the configuration box (avcC) from them.
 * The avcC some encoders give of their own is malformed (Media Foundation under
 * Windows: each SPS and PPS with its header byte twice, reserved bits cleared):
 * Chrome and VLC play such a file, the strict players (Windows, QuickTime,
 * phones, TVs) refuse it.
 */
export const AVC_FROM_STREAM = {
  onEncoderConfig: (config: VideoEncoderConfig) => { config.avc = { ...config.avc, format: 'annexb' }; },
  onEncodedPacket: (packet: { data: Uint8Array }, meta?: EncodedVideoChunkMetadata) => {
    if (meta?.decoderConfig && isAnnexB(packet.data)) delete meta.decoderConfig.description;
  },
};
