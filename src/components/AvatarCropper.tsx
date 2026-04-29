"use client";

import ReactCrop, { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { forwardRef } from "react";

// Thin wrapper around ReactCrop so consumers can lazy-load it via
// next/dynamic without dragging react-image-crop (~70 KB parsed) +
// its CSS into the parent component's chunk.
type AvatarCropperProps = {
  src: string;
  crop: Crop;
  onCropChange: (c: Crop) => void;
  aspect: number;
  imgClassName?: string;
};

const AvatarCropper = forwardRef<HTMLImageElement, AvatarCropperProps>(
  function AvatarCropper({ src, crop, onCropChange, aspect, imgClassName }, ref) {
    return (
      <ReactCrop crop={crop} onChange={onCropChange} aspect={aspect}>
        <img ref={ref} src={src} alt="Crop preview" className={imgClassName} />
      </ReactCrop>
    );
  }
);

export default AvatarCropper;
