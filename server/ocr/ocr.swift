// Reads the text on a screenshot with the macOS Vision framework and prints it, one line per text block.
// Usage: ocr <image.png> [--boxes]
import Foundation
import Vision

guard CommandLine.arguments.count == 2 || (CommandLine.arguments.count == 3 && CommandLine.arguments[2] == "--boxes") else {
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
let observations = (request.results ?? [])
  .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY || ($0.boundingBox.maxY == $1.boundingBox.maxY && $0.boundingBox.minX < $1.boundingBox.minX) }
if CommandLine.arguments.count == 3 {
  let rows: [[String: Any]] = observations.compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let b = observation.boundingBox
    return ["text": candidate.string, "confidence": candidate.confidence,
            "x": b.minX, "y": b.minY, "width": b.width, "height": b.height]
  }
  let data = try JSONSerialization.data(withJSONObject: rows)
  FileHandle.standardOutput.write(data)
} else {
  print(observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
}
