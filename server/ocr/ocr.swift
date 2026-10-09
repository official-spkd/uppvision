// Reads the text on a screenshot with the macOS Vision framework and prints it, one line per text block.
// Usage: ocr <image.png>
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write("usage: ocr <image>\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.automaticallyDetectsLanguage = true
do {
  try VNImageRequestHandler(url: url, options: [:]).perform([request])
} catch {
  FileHandle.standardError.write("ocr failed: \(error)\n".data(using: .utf8)!)
  exit(1)
}
let lines = (request.results ?? [])
  .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY || ($0.boundingBox.maxY == $1.boundingBox.maxY && $0.boundingBox.minX < $1.boundingBox.minX) }
  .compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
