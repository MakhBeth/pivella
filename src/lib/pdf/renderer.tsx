import React from 'react';
import type { Company, Line, Payment, Invoice, Installment, PDFOptions } from './types';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Link,
  Image,
} from '@react-pdf/renderer';
import { getTranslations } from './translations';

// Register font for browser - using public URL path
Font.register({
  family: 'Roboto-Mono',
  src: '/fonts/RobotoMono-Regular.ttf',
});

// Create Document Component
const GeneratePDF = (invoice: Invoice, options: PDFOptions) => {
  const colors = {
    primary: options.colors?.primary || '#6699cc',
    text: options.colors?.text || '#033243',
    lighterText: options.colors?.lighterText || '#476976',
    footerText: options.colors?.footerText || '#8CA1A9',
    lighterGray: options.colors?.lighterGray || '#E8ECED',
    tableHeader: options.colors?.tableHeader || '#D1D9DC',
  };

  const locale = options.locale || 'it';
  const t = getTranslations(locale);

  // Table column widths
  const tableFormat = [
    { width: '10%' },
    { width: '32%' },
    { width: '10%', textAlign: 'right' as const },
    { width: '20%', textAlign: 'right' as const },
    { width: '20%', textAlign: 'right' as const },
    { width: '8%', textAlign: 'right' as const },
  ];

  // Recap styles (separate from StyleSheet)
  const recapStyles = {
    row: {
      flexDirection: 'row' as const,
      paddingLeft: 5,
      paddingRight: 15,
      paddingTop: 3,
      paddingBottom: 3,
    },
    label: {
      width: '40%',
      paddingTop: 3,
      fontSize: 9,
    },
    value: {
      width: '60%',
      textAlign: 'right' as const,
      fontFamily: 'Roboto-Mono',
      paddingRight: 34,
    },
  };

  // Create styles
  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#fff',
      fontSize: 10,
      color: colors.text,
      paddingBottom: 30,
      paddingTop: 30,
    },
    section: {
      flexGrow: 1,
      marginTop: 10,
    },
    invoiceData: {
      color: colors.lighterText,
    },
    companyLine: {
      marginBottom: 1.2,
    },
    line: {
      padding: 6,
      paddingBottom: 7,
      paddingTop: 10,
    },
    numbers: {
      fontFamily: 'Roboto-Mono',
      textAlign: 'right' as const,
    },
    recapBox: {
      width: '50%',
      backgroundColor: colors.primary,
      textAlign: 'right' as const,
      color: 'white',
      paddingTop: 7,
      paddingBottom: 7,
      alignItems: 'center' as const,
    },
    title: {
      fontFamily: 'Helvetica-Bold',
      marginBottom: 7,
      fontSize: 14,
    },
    lineHeader: {
      backgroundColor: colors.tableHeader,
      flexDirection: 'row' as const,
      fontFamily: 'Helvetica-Bold',
    },
    lineRow: {
      flexDirection: 'row' as const,
      borderBottomWidth: 1,
      borderBottomStyle: 'solid' as const,
      borderBottomColor: colors.lighterGray,
    },
  });

  const currencySymbol = (currency: string): string => {
    // Check custom map from config first
    if (options.currencyMap?.[currency]) {
      return options.currencyMap[currency];
    }
    switch (currency) {
      case 'EUR':
        return '\u20AC';
      case 'USD':
        return '$';
      case 'GBP':
        return '\u00A3';
      default:
        return ` ${currency}`;
    }
  };

  const CompanyView = ({
    company,
    role,
  }: {
    company: Company;
    role: string;
  }): React.ReactElement => {
    const { office, contacts } = company;
    return (
      <View style={[styles.section, { maxWidth: '50%', paddingRight: 10 }]}>
        <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>
          {role}
        </Text>
        <Text style={{ fontSize: 12, color: colors.primary }}>
          {company.name}
        </Text>
        {company.vat ? (
          <Text style={styles.companyLine}>
            {t.vatNumber}: {company.vat}
          </Text>
        ) : null}
        {office && (
          <React.Fragment>
            {(office.address || office.number) && (
              <Text style={styles.companyLine}>
                {[office.address, office.number].filter(Boolean).join(' ')}
              </Text>
            )}
            <Text style={styles.companyLine}>
              {[office.cap, office.city, office.district ? `(${office.district})` : null, office.country].filter(Boolean).join(' ')}
            </Text>
          </React.Fragment>
        )}
        {contacts && (
          <React.Fragment>
            {contacts.tel && (
              <Text style={styles.companyLine}>
                {t.telephone} {contacts.tel}
              </Text>
            )}
            <Text style={styles.companyLine}>{contacts.email}</Text>
          </React.Fragment>
        )}
      </View>
    );
  };

  const HR = (): React.ReactElement => (
    <View
      style={{
        backgroundColor: colors.tableHeader,
        height: 1,
        marginTop: 15,
        marginBottom: 15,
      }}
    />
  );

  const LineHeader = (): React.ReactElement => (
    <View style={styles.lineHeader}>
      <Text style={[styles.line, tableFormat[0]]}>{t.lineNumber}</Text>
      <Text style={[styles.line, tableFormat[1]]}>{t.description}</Text>
      <Text style={[styles.line, tableFormat[2]]}>{t.quantity}</Text>
      <Text style={[styles.line, tableFormat[3]]}>{t.price}</Text>
      <Text style={[styles.line, tableFormat[4]]}>{t.total}</Text>
      <Text style={[styles.line, tableFormat[5]]}>{t.vat}</Text>
    </View>
  );

  const LineItem = ({
    line,
    currency,
  }: {
    line: Line;
    currency: string;
  }): React.ReactElement => (
    <View style={styles.lineRow}>
      <Text style={[styles.line, tableFormat[0]]}>{line.number}</Text>
      <Text style={[styles.line, tableFormat[1]]}>
        {line.description}
      </Text>
      <Text style={[styles.line, styles.numbers, tableFormat[2]]}>
        {line.quantity}
      </Text>
      <Text style={[styles.line, styles.numbers, tableFormat[3]]}>
        {line.singlePrice.toLocaleString(locale)}
        {currencySymbol(currency)}
      </Text>
      <Text style={[styles.line, styles.numbers, tableFormat[4]]}>
        {line.amount.toLocaleString(locale)}
        {currencySymbol(currency)}
      </Text>
      <Text style={[styles.line, styles.numbers, tableFormat[5]]}>
        {line.tax}%
      </Text>
    </View>
  );

  const InvoiceData = ({
    number,
    issueDate,
  }: {
    number: string;
    issueDate: Date;
  }): React.ReactElement => (
    <View style={{ textAlign: 'right', marginTop: 10 }}>
      <Text style={styles.invoiceData}>
        <Text style={{ fontSize: 10 }}>{t.number}:</Text> {number}
      </Text>
      <Text style={styles.invoiceData}>
        <Text style={{ fontSize: 10 }}>{t.date}:</Text>{' '}
        {issueDate.toLocaleDateString(locale, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })}
      </Text>
    </View>
  );

  const PaymentView = ({
    payment,
    currency,
  }: {
    payment: Payment;
    currency: string;
  }): React.ReactElement => (
    <View style={{ lineHeight: 1.5, color: colors.lighterText }}>
      {payment.method && (
        <View>
          <Text>
            {t.paymentMethod}: {payment.method}
          </Text>
        </View>
      )}
      {payment.bank && (
        <View>
          <Text>
            {t.bank}: {payment.bank}
          </Text>
        </View>
      )}
      {payment.iban && (
        <View>
          <Text>IBAN: {payment.iban}</Text>
        </View>
      )}
      {payment.regularPaymentDate && (
        <View>
          <Text>
            {t.dueDate}:{' '}
            {payment.regularPaymentDate.toLocaleDateString(locale, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </Text>
        </View>
      )}
      <View>
        <Text>
          {t.amount}: {payment.amount.toLocaleString(locale)}
          {currency}
        </Text>
      </View>
    </View>
  );

  const Recap = ({
    installment,
  }: {
    installment: Installment;
  }): React.ReactElement => (
    <View style={styles.recapBox}>
      <View style={{ ...recapStyles.row, marginTop: 12 }}>
        <Text style={recapStyles.label}>{t.totalProductsServices}</Text>
        <Text style={recapStyles.value}>
          {installment.taxSummary.paymentAmount.toLocaleString(locale)}
          {currencySymbol(installment.currency)}
        </Text>
      </View>
      <View style={recapStyles.row}>
        <Text style={recapStyles.label}>{t.totalVat}</Text>
        <Text style={recapStyles.value}>
          {installment.taxSummary.taxAmount.toLocaleString(locale)}
          {currencySymbol(installment.currency)}
        </Text>
      </View>
      {installment.rounding !== undefined && installment.rounding !== installment.totalAmount && (
        <View style={recapStyles.row}>
          <Text style={recapStyles.label}>{t.rounding}</Text>
          <Text style={recapStyles.value}>
            {installment.rounding.toLocaleString(locale)}
            {currencySymbol(installment.currency)}
          </Text>
        </View>
      )}
      <View
        style={{
          ...recapStyles.row,
          marginBottom: 20,
          alignItems: 'flex-end',
        }}
      >
        <Text style={recapStyles.label}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>
            {t.total}
          </Text>
        </Text>
        <Text style={[recapStyles.value, { fontSize: 21, lineHeight: 1 }]}>
          {installment.totalAmount.toLocaleString(locale)}
          {currencySymbol(installment.currency)}
        </Text>
      </View>
    </View>
  );

  // Use logoSrc from options, or undefined if not set
  const logoSrc = options.logoSrc;

  return (
    <Document>
      {invoice.installments.map((installment) => (
        <Page
          size="A4"
          style={styles.page}
          key={`installment-${installment.number}`}
        >
          <View
            style={{
              paddingLeft: 30,
              paddingRight: 30,
              height: '100%',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <View>
              <View
                style={{
                  backgroundColor: colors.primary,
                  height: 15,
                  width: '100%',
                  marginTop: -35,
                }}
              />
              <InvoiceData
                number={installment.number}
                issueDate={installment.issueDate}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {logoSrc && (
                  <Image
                    style={{ width: 70, height: 70, marginTop: 0, marginRight: 10 }}
                    src={logoSrc}
                  />
                )}
                <CompanyView company={invoice.invoicer} role={t.supplier} />
                <CompanyView company={invoice.invoicee} role={t.customer} />
                {invoice.thirdParty && (
                  <CompanyView company={invoice.thirdParty} role={t.intermediary} />
                )}
              </View>
              {installment.description && (
                <React.Fragment>
                  <HR />
                  <Text style={styles.title}>{t.cause}</Text>
                  <Text>{installment.description}</Text>
                </React.Fragment>
              )}
              <HR />
              <Text style={styles.title}>{t.productsAndServices}</Text>
              <LineHeader />
              {installment.lines.map((line) => (
                <LineItem
                  line={line}
                  currency={installment.currency}
                  key={line.number}
                />
              ))}
              {installment.attachments && (
                <React.Fragment>
                  <Text style={[styles.title, { marginTop: 15 }]}>
                    {t.attachedDocs}
                  </Text>
                  <View style={styles.lineHeader}>
                    <Text style={[styles.line, { width: '50%' }]}>
                      {t.name}
                    </Text>
                    <Text style={[styles.line, { width: '50%' }]}>
                      {t.description}
                    </Text>
                  </View>
                  {installment.attachments.map((attachment) => (
                    <View
                      style={styles.lineRow}
                      key={`attachment-${attachment.name}`}
                    >
                      <Text style={[styles.line, { width: '50%' }]}>
                        {attachment.name}
                      </Text>
                      <Text style={[styles.line, { width: '50%' }]}>
                        {attachment.description}
                      </Text>
                    </View>
                  ))}
                </React.Fragment>
              )}
            </View>
            {options.exchangeRateNote && (
              <View style={{ marginTop: 12, padding: 8, backgroundColor: colors.lighterGray, borderRadius: 3 }}>
                <Text style={{ fontSize: 8, color: colors.lighterText }}>
                  {options.exchangeRateNote}
                </Text>
              </View>
            )}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                marginTop: 'auto',
                marginBottom: 20,
              }}
            >
              <View style={{ width: '50%' }}>
                {installment.stampDuty && (
                  <React.Fragment>
                    <Text style={[styles.title, { marginTop: 10 }]}>
                      {t.stampDuty}
                    </Text>
                    <Text style={{ color: colors.lighterText }}>
                      {installment.stampDuty.toLocaleString(locale)}
                      {'\u20AC'}
                    </Text>
                  </React.Fragment>
                )}
                {installment.payment && (
                  <React.Fragment>
                    <Text style={[styles.title, { marginTop: 10 }]}>
                      {t.paymentDetails}
                    </Text>
                    <PaymentView
                      payment={installment.payment}
                      currency={currencySymbol(installment.currency)}
                    />
                  </React.Fragment>
                )}
              </View>
              <Recap installment={installment} />
            </View>
            {options.footer && (
              <View
                style={{
                  color: colors.footerText,
                  textAlign: 'center',
                  fontSize: 8,
                  padding: 5,
                  marginBottom: -20,
                }}
              >
                <Text>
                  {t.generatedBy}{' '}
                  <Link
                    style={{ color: colors.primary }}
                    src={options.footerLink || 'https://github.com/MakhBeth/pivella'}
                  >
                    {options.footerText || 'Pivella'}
                  </Link>
                </Text>
              </View>
            )}
          </View>
        </Page>
      ))}
    </Document>
  );
};

export default GeneratePDF;
