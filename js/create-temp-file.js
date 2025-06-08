export default function createTempFile(name, sizeInMb) {
  return new Promise((resolve) => {
    const fileSystem = (window.requestFileSystem || window.webkitRequestFileSystem);
    fileSystem(window.TEMPORARY, sizeInMb * 1024 * 1024, (fs) => {
      fs.root.getFile(name, { create: true }, (fileEntry) => {
        resolve(fileEntry);
      });
    });
  });
}