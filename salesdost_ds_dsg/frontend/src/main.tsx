import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { RetailerProvider } from './contexts/RetailerContext.tsx'
import { DataProvider } from './contexts/DataContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RetailerProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </RetailerProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
