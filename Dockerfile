FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/render-sales-invoice-pdf.py tools/render-sales-invoice-pdf.py
COPY tools/serve-invoice-pdf.py tools/serve-invoice-pdf.py

ENV STA_INVOICE_UPLOAD=false
ENV STA_INVOICE_CACHE_TTL_SECONDS=900

CMD ["python", "tools/serve-invoice-pdf.py"]
