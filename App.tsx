import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadPdfDocument, renderPageToImage, RenderedPage } from './utils/pdfHelpers';
import { colorizeImage } from './services/localImageService';
import { Button } from './components/Button';
import jsPDF from 'jspdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Define icons as components or simple elements
const UploadIcon = () => <i className="fas fa-cloud-upload-alt"></i>;
const MagicIcon = () => <i className="fas fa-magic"></i>;
const DownloadIcon = () => <i className="fas fa-download"></i>;
const ChevronLeftIcon = () => <i className="fas fa-chevron-left"></i>;
const ChevronRightIcon = () => <i className="fas fa-chevron-right"></i>;
const TrashIcon = () => <i className="fas fa-trash"></i>;
const CheckIcon = () => <i className="fas fa-check"></i>;
const LayersIcon = () => <i className="fas fa-layer-group"></i>;
const ImageIcon = () => <i className="far fa-image"></i>;
const SlidersIcon = () => <i className="fas fa-sliders-h"></i>;

type ColorTheme = 'black' | 'green' | 'blue' | 'red' | 'purple' | 'orange' | 'custom';

const THEMES: { id: ColorTheme; name: string; hex: string }[] = [
  { 
    id: 'black', 
    name: 'Sharp Black', 
    hex: '#000000' 
  },
  { 
    id: 'green', 
    name: 'Emerald Green', 
    hex: '#10B981' 
  },
  { 
    id: 'blue', 
    name: 'Royal Blue', 
    hex: '#3B82F6' 
  },
  { 
    id: 'red', 
    name: 'Crimson Red', 
    hex: '#EF4444' 
  },
  { 
    id: 'purple', 
    name: 'Deep Purple', 
    hex: '#8B5CF6' 
  },
  { 
    id: 'orange', 
    name: 'Burnt Orange', 
    hex: '#F97316' 
  },
];

interface ColorizedPageData {
  imageUrl: string;
  width: number;
  height: number;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [numPages, setNumPages] = useState<number>(0);
  
  // Stores the rendered original image for the current page
  const [originalPageImage, setOriginalPageImage] = useState<RenderedPage | null>(null);
  
  // Stores colorized versions: Key is page number, Value is object with dataUrl and dimensions
  const [colorizedPages, setColorizedPages] = useState<Map<number, ColorizedPageData>>(new Map());
  
  // UI State
  const [selectedTheme, setSelectedTheme] = useState<ColorTheme>('black');
  const [customColorHex, setCustomColorHex] = useState<string>('#6366f1'); // Default to Indigo
  
  // Resolution & Processing State
  const [resolutionScale, setResolutionScale] = useState<number>(3.0); // Default High
  const [boldness, setBoldness] = useState<number>(60); // 0-100, default 60 for deep color
  const [showSettings, setShowSettings] = useState<boolean>(true);

  // Margin State: Percentage based
  const [marginPercent, setMarginPercent] = useState<number>(0);
  const [isCustomMargin, setIsCustomMargin] = useState<boolean>(false);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [isRenderingPdf, setIsRenderingPdf] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to get the active hex color
  const getActiveHexColor = () => {
    if (selectedTheme === 'custom') return customColorHex;
    return THEMES.find(t => t.id === selectedTheme)?.hex || '#000000';
  };

  const getActiveThemeName = () => {
    if (selectedTheme === 'custom') return 'Custom Color';
    return THEMES.find(t => t.id === selectedTheme)?.name || 'Unknown';
  };

  // Handle File Upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (uploadedFile && uploadedFile.type === 'application/pdf') {
      try {
        setFile(uploadedFile);
        setIsRenderingPdf(true);
        setError(null);
        
        const doc = await loadPdfDocument(uploadedFile);
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
        setColorizedPages(new Map());
        setBatchProgress(null);
        
        // Initial render of page 1
        await renderCurrentPage(doc, 1, resolutionScale);
        
      } catch (err) {
        console.error(err);
        setError("Failed to load PDF. Please ensure it is a valid PDF file.");
      } finally {
        setIsRenderingPdf(false);
      }
    }
  };

  // Helper to render a specific page
  const renderCurrentPage = async (doc: PDFDocumentProxy, pageNum: number, scale: number) => {
    setIsRenderingPdf(true);
    try {
      const rendered = await renderPageToImage(doc, pageNum, scale); 
      setOriginalPageImage(rendered);
    } catch (err) {
      console.error(err);
      setError("Failed to render page.");
    } finally {
      setIsRenderingPdf(false);
    }
  };

  // Effect to re-render when page or resolution changes
  useEffect(() => {
    if (pdfDoc) {
      // Debounce re-render slightly to avoid thrashing on slider change if we were to auto-rerender (we don't auto-colorize, but we auto-render original)
      const timer = setTimeout(() => {
        renderCurrentPage(pdfDoc, currentPage, resolutionScale);
      }, 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pdfDoc, resolutionScale]);

  // Colorization Handler (Single Page)
  const handleColorizeCurrent = async () => {
    if (!originalPageImage) return;

    setIsProcessing(true);
    setError(null);

    const targetHex = getActiveHexColor();

    try {
      const result = await colorizeImage(originalPageImage.dataUrl, targetHex, boldness);
      
      if (result.error) {
        setError(result.error);
      } else if (result.imageUrl) {
        setColorizedPages(prev => new Map(prev).set(currentPage, {
          imageUrl: result.imageUrl!,
          width: originalPageImage.width,
          height: originalPageImage.height
        }));
      }
    } catch (err) {
      setError("An unexpected error occurred during colorization.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Batch Colorization Handler (All Pages)
  const handleColorizeAll = async () => {
    if (!pdfDoc) return;

    setIsProcessing(true);
    setBatchProgress({ current: 0, total: numPages });
    setError(null);

    const targetHex = getActiveHexColor();
    const newColorizedMap = new Map(colorizedPages);

    try {
      // Loop through all pages
      for (let i = 1; i <= numPages; i++) {
        setBatchProgress({ current: i, total: numPages });
        
        let pageImageBase64 = '';
        let width = 0;
        let height = 0;

        // Note: For batch processing, we always re-render to ensure consistency with current resolutionScale
        const rendered = await renderPageToImage(pdfDoc, i, resolutionScale); 
        pageImageBase64 = rendered.dataUrl;
        width = rendered.width;
        height = rendered.height;

        const result = await colorizeImage(pageImageBase64, targetHex, boldness);

        if (result.error) {
           console.error(`Error on page ${i}:`, result.error);
        } else if (result.imageUrl) {
           newColorizedMap.set(i, {
             imageUrl: result.imageUrl,
             width,
             height
           });
           setColorizedPages(new Map(newColorizedMap));
        }
      }
    } catch (err) {
      setError("Batch processing stopped due to an error.");
      console.error(err);
    } finally {
      setIsProcessing(false);
      setBatchProgress(null);
    }
  };

  // Download Handler (Rebuild PDF)
  const handleDownloadPDF = () => {
    if (colorizedPages.size === 0) return;

    try {
      // Initialize jsPDF
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: 'a4'
      });

      const sortedPages = Array.from(colorizedPages.entries()).sort((a, b) => a[0] - b[0]);
      
      sortedPages.forEach(([pageNum, data]) => {
        const { imageUrl, width, height } = data;

        // Calculate margin in pixels based on percentage of width
        const marginPx = Math.floor(width * (marginPercent / 100));
        
        // New page size is original image size + margins on both sides
        const pageWidth = width + (marginPx * 2);
        const pageHeight = height + (marginPx * 2);

        // Add a new page with the dimensions including margin
        doc.addPage([pageWidth, pageHeight]);
        
        // Add the image to the newly created page, offset by the margin
        doc.addImage(imageUrl, 'PNG', marginPx, marginPx, width, height);
      });

      // Remove the default empty page (page 1) created upon initialization
      const totalPages = doc.getNumberOfPages();
      if (totalPages > sortedPages.length) {
        doc.deletePage(1); 
      }

      doc.save(`chromapdf_${selectedTheme}_${file?.name || 'document'}.pdf`);

    } catch (err) {
      console.error(err);
      setError("Failed to generate PDF download. Try again.");
    }
  };

  // Download Single PNG
  const handleDownloadPNG = () => {
    const pageData = colorizedPages.get(currentPage);
    if (!pageData) return;

    const link = document.createElement('a');
    link.href = pageData.imageUrl;
    link.download = `page_${currentPage}_${selectedTheme}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    setFile(null);
    setPdfDoc(null);
    setColorizedPages(new Map());
    setOriginalPageImage(null);
    setCurrentPage(1);
    setError(null);
    setBatchProgress(null);
    setSelectedTheme('black');
    setMarginPercent(0);
    setIsCustomMargin(false);
    setResolutionScale(3.0);
    setBoldness(60);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 font-sans">
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
              <i className="fas fa-palette text-white text-sm"></i>
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              ChromaPDF
            </h1>
          </div>
          
          <div className="flex items-center space-x-4">
             {file && (
               <Button variant="ghost" onClick={handleReset} className="text-sm">
                 <TrashIcon /><span className="ml-2 hidden sm:inline">Clear</span>
               </Button>
             )}
             <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full border border-gray-200">
               <i className="fas fa-bolt mr-1 text-yellow-500"></i>
               Local
             </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-start p-4 sm:p-6 lg:p-8 space-y-6">
        
        {/* Error Notification */}
        {error && (
          <div className="w-full max-w-4xl bg-red-50 border-l-4 border-red-500 p-4 rounded-md shadow-sm animate-fade-in">
            <div className="flex">
              <div className="flex-shrink-0">
                <i className="fas fa-exclamation-circle text-red-500"></i>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Upload State */}
        {!file && (
          <div className="w-full max-w-xl mt-12 bg-white rounded-2xl shadow-xl border border-gray-100 p-12 text-center transition-all hover:shadow-2xl">
            <div className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-full bg-indigo-50 text-indigo-600">
              <i className="fas fa-file-pdf text-3xl"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload your B&W PDF</h2>
            <p className="text-gray-500 mb-8">Fast, private, and runs entirely in your browser.</p>
            
            <div className="relative group">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <Button size="lg" className="w-full sm:w-auto relative z-0 pointer-events-none group-hover:bg-indigo-700">
                <UploadIcon /> <span className="ml-2">Select PDF File</span>
              </Button>
            </div>
            <p className="mt-4 text-xs text-gray-400">Supported format: .pdf (Max 10MB recommended)</p>
          </div>
        )}

        {/* Control Bar (Only when file loaded) */}
        {file && (
          <div className="w-full max-w-7xl bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col gap-4 sticky top-20 z-20 transition-all">
            
            {/* Top Row: Colors and Main Actions */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              
              {/* Color Palette */}
              <div className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedTheme(theme.id)}
                      className={`w-9 h-9 rounded-full shadow-sm transition-transform hover:scale-110 focus:outline-none flex items-center justify-center border-2 ${selectedTheme === theme.id ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ background: theme.hex }}
                      title={theme.name}
                    >
                      {selectedTheme === theme.id && <i className="fas fa-check text-white text-[10px] drop-shadow-md"></i>}
                    </button>
                  ))}
                  
                  {/* Custom Color Picker */}
                  <div className="relative group">
                    <div className={`w-9 h-9 rounded-full shadow-sm overflow-hidden border-2 flex items-center justify-center transition-transform hover:scale-110 ${selectedTheme === 'custom' ? 'border-gray-900 scale-110' : 'border-gray-200'}`}
                         style={{ background: selectedTheme === 'custom' ? customColorHex : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
                      {selectedTheme === 'custom' && <i className="fas fa-check text-white text-[10px] drop-shadow-md mix-blend-difference"></i>}
                      <input 
                        type="color" 
                        value={customColorHex}
                        onChange={(e) => {
                          setCustomColorHex(e.target.value);
                          setSelectedTheme('custom');
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        title="Choose Custom Color"
                      />
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  className={`ml-2 text-gray-400 hover:text-indigo-600 transition-colors ${showSettings ? 'text-indigo-600' : ''}`}
                  title="Toggle Advanced Settings"
                >
                  <SlidersIcon />
                </button>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 justify-end flex-1">
                 <Button 
                    onClick={handleColorizeCurrent} 
                    disabled={isProcessing}
                    className="whitespace-nowrap h-10 text-sm"
                  >
                    <MagicIcon /> <span className="ml-2">Colorize Page {currentPage}</span>
                 </Button>
                 
                 <Button 
                    onClick={handleColorizeAll} 
                    disabled={isProcessing} 
                    variant="secondary"
                    className="whitespace-nowrap h-10 text-sm"
                  >
                    <LayersIcon /> <span className="ml-2">Colorize All</span>
                 </Button>
              </div>
            </div>

            {/* Bottom Row: Advanced Settings (Expandable) */}
            {showSettings && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-gray-100 animate-fade-in text-sm text-gray-600">
                  
                  {/* Resolution */}
                  <div className="flex flex-col gap-1">
                     <div className="flex justify-between">
                       <label className="font-medium text-xs uppercase tracking-wider">Resolution Quality</label>
                       <span className="text-xs text-indigo-600 font-bold">{resolutionScale}x</span>
                     </div>
                     <input 
                       type="range" 
                       min="1.5" 
                       max="8.0" 
                       step="0.5" 
                       value={resolutionScale} 
                       onChange={(e) => setResolutionScale(Number(e.target.value))}
                       className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                       title="Higher resolution creates sharper text but uses more memory."
                     />
                     <div className="flex justify-between text-[10px] text-gray-400">
                        <span>Fast (1.5x)</span>
                        <span>Ultra (8.0x)</span>
                     </div>
                  </div>

                  {/* Boldness / Threshold */}
                  <div className="flex flex-col gap-1">
                     <div className="flex justify-between">
                       <label className="font-medium text-xs uppercase tracking-wider">Boldness / Depth</label>
                       <span className="text-xs text-indigo-600 font-bold">{boldness}%</span>
                     </div>
                     <input 
                       type="range" 
                       min="0" 
                       max="100" 
                       step="5" 
                       value={boldness} 
                       onChange={(e) => setBoldness(Number(e.target.value))}
                       className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                       title="Increase for deeper color, decrease for smoother edges."
                     />
                     <div className="flex justify-between text-[10px] text-gray-400">
                        <span>Soft</span>
                        <span>Sharp</span>
                     </div>
                  </div>

                  {/* Margins */}
                  <div className="flex flex-col gap-1">
                     <label className="font-medium text-xs uppercase tracking-wider">Output Margin</label>
                     <div className="flex items-center bg-gray-50 rounded-lg border border-gray-200 px-2 h-8">
                        <select 
                            value={isCustomMargin ? 'custom' : marginPercent} 
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'custom') {
                                setIsCustomMargin(true);
                                setMarginPercent(10);
                              } else {
                                setIsCustomMargin(false);
                                setMarginPercent(Number(val));
                              }
                            }}
                            className="text-xs bg-transparent border-none outline-none focus:ring-0 text-gray-700 cursor-pointer w-full"
                        >
                            <option value={0}>None (0%)</option>
                            <option value={5}>Small (5%)</option>
                            <option value={10}>Medium (10%)</option>
                            <option value={15}>Large (15%)</option>
                            <option value="custom">Custom</option>
                        </select>
                        {isCustomMargin && (
                          <input 
                             type="number" 
                             min="0" max="50"
                             value={marginPercent}
                             onChange={(e) => setMarginPercent(Math.min(50, Math.max(0, Number(e.target.value))))}
                             className="w-12 text-xs text-center outline-none border-l border-gray-200 ml-2 bg-transparent"
                           />
                        )}
                     </div>
                  </div>

              </div>
            )}
          </div>
        )}

        {/* Batch Progress Overlay */}
        {batchProgress && (
           <div className="w-full max-w-2xl bg-indigo-900 text-white rounded-lg p-4 shadow-lg flex items-center justify-between animate-fade-in z-40 relative">
              <div className="flex items-center">
                 <div className="animate-spin mr-3"><i className="fas fa-circle-notch"></i></div>
                 <div>
                    <p className="font-semibold">Batch Processing...</p>
                    <p className="text-xs text-indigo-200">Processing page {batchProgress.current} of {batchProgress.total}</p>
                 </div>
              </div>
              <div className="w-32 bg-indigo-800 rounded-full h-2">
                 <div 
                   className="bg-indigo-400 h-2 rounded-full transition-all duration-300" 
                   style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                 ></div>
              </div>
           </div>
        )}

        {/* Viewer State */}
        {file && (
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            
            {/* Left Column: Original */}
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-700 flex items-center">
                  <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center mr-2">1</span>
                  Original
                </h3>
                <div className="flex items-center space-x-2 text-sm bg-white px-3 py-1 rounded-full shadow-sm border border-gray-200">
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1 || isProcessing}
                    className="p-1 text-gray-500 hover:text-indigo-600 disabled:opacity-30"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <span className="text-gray-600 font-medium w-16 text-center">
                    {currentPage} / {numPages}
                  </span>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    disabled={currentPage === numPages || isProcessing}
                    className="p-1 text-gray-500 hover:text-indigo-600 disabled:opacity-30"
                  >
                    <ChevronRightIcon />
                  </button>
                </div>
              </div>

              <div className="relative bg-gray-200/50 rounded-xl overflow-hidden shadow-inner border border-gray-200 min-h-[500px] flex items-center justify-center group">
                {isRenderingPdf ? (
                  <div className="flex flex-col items-center text-gray-400">
                     <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
                     <span className="text-sm">Rendering PDF...</span>
                  </div>
                ) : originalPageImage ? (
                  <div className="overflow-auto w-full h-full flex items-center justify-center p-4">
                    <img 
                      src={originalPageImage.dataUrl} 
                      alt={`Page ${currentPage} Original`} 
                      className="max-w-none shadow-lg object-contain"
                      style={{ 
                        // If resolution is high, scale down for preview, but allow zoom logic if implemented (simple fit here)
                        maxHeight: '100%', 
                        maxWidth: '100%' 
                      }}
                    />
                  </div>
                ) : (
                  <span className="text-gray-400">No page loaded</span>
                )}
              </div>
            </div>

            {/* Right Column: Result */}
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-700 flex items-center">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs flex items-center justify-center mr-2">2</span>
                  Colorized Result
                </h3>
                
                <div className="flex items-center space-x-2">
                    {/* Download Buttons */}
                    {colorizedPages.has(currentPage) && (
                      <Button 
                          variant="ghost" 
                          onClick={handleDownloadPNG} 
                          className="text-xs h-8 px-2 border border-gray-200 bg-white"
                          disabled={isProcessing}
                          title="Download this page as PNG"
                      >
                          <ImageIcon /> <span className="ml-1 hidden sm:inline">PNG</span>
                      </Button>
                    )}

                    {colorizedPages.size > 0 && (
                    <Button 
                        variant="secondary" 
                        onClick={handleDownloadPDF} 
                        className="text-xs h-8 px-3"
                        disabled={isProcessing}
                        title="Download all processed pages as PDF"
                    >
                        <DownloadIcon /><span className="ml-2">Download PDF</span>
                    </Button>
                    )}
                </div>
              </div>

              <div className="relative bg-indigo-50/50 rounded-xl overflow-hidden shadow-inner border border-indigo-100 min-h-[500px] flex items-center justify-center">
                {isProcessing && !batchProgress ? (
                  <div className="flex flex-col items-center justify-center text-indigo-600">
                    <div className="relative w-16 h-16 mb-4">
                      <div className="absolute inset-0 border-4 border-indigo-200 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                      <i className="fas fa-magic absolute inset-0 flex items-center justify-center text-indigo-400 text-lg animate-pulse"></i>
                    </div>
                    <p className="font-medium animate-pulse">Processing Page...</p>
                  </div>
                ) : colorizedPages.has(currentPage) ? (
                  <div className="overflow-auto w-full h-full flex items-center justify-center p-4">
                    <img 
                      src={colorizedPages.get(currentPage)?.imageUrl} 
                      alt={`Page ${currentPage} Colorized`} 
                      className="max-w-none shadow-lg object-contain animate-fade-in"
                      style={{ 
                        maxHeight: '100%', 
                        maxWidth: '100%' 
                      }}
                    />
                    <div className="absolute top-4 right-4 z-10">
                       <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-medium shadow-sm border border-green-200 backdrop-blur-sm bg-opacity-90">
                         {getActiveThemeName()}
                       </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                      <i className="fas fa-image text-2xl"></i>
                    </div>
                    <p className="text-gray-500 font-medium">No result for this page.</p>
                    <p className="text-sm text-gray-400 mt-2">Select settings and click "Colorize".</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-400 text-sm">
          <p>&copy; {new Date().getFullYear()} ChromaPDF. Local Browser Processing.</p>
        </div>
      </footer>
      
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}