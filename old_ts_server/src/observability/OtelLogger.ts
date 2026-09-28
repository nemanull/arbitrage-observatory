import { ConsoleLogger } from '@nestjs/common';
import {
  SeverityNumber,
  logs,
  type AnyValue,
  type LogAttributes,
  type Logger,
} from '@opentelemetry/api-logs';
import { ATTR_EXCEPTION_STACKTRACE } from '@opentelemetry/semantic-conventions';

const SCOPE = 'nest';

const ATTR_NEST_CONTEXT = 'nest.context';

export class OtelLogger extends ConsoleLogger {
  private otelLogger: Logger | undefined;

  log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(message, ...(optionalParams as [string?]));
    this.emit(SeverityNumber.INFO, 'INFO', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...(optionalParams as [string?]));
    this.emit(SeverityNumber.ERROR, 'ERROR', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(message, ...(optionalParams as [string?]));
    this.emit(SeverityNumber.WARN, 'WARN', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(message, ...(optionalParams as [string?]));
    this.emit(SeverityNumber.DEBUG, 'DEBUG', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(message, ...(optionalParams as [string?]));
    this.emit(SeverityNumber.TRACE, 'TRACE', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(message, ...(optionalParams as [string?]));
    this.emit(SeverityNumber.FATAL, 'FATAL', message, optionalParams);
  }

  private emit(
    severityNumber: SeverityNumber,
    severityText: string,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    this.otelLogger ??= logs.getLogger(SCOPE);

    const params = [...optionalParams];
    const last = params[params.length - 1];
    const context =
      typeof last === 'string' && !isStack(last) ? params.pop() : this.context;
    const stack = params.find((param) => typeof param === 'string' && isStack(param));

    const attributes: LogAttributes = {};
    if (context) {
      attributes[ATTR_NEST_CONTEXT] = context as string;
    }
    if (stack) {
      attributes[ATTR_EXCEPTION_STACKTRACE] = stack as string;
    }

    this.otelLogger.emit({
      severityNumber,
      severityText,
      body: toBody(message, attributes),
      attributes,
    });
  }
}


function toBody(message: unknown, attributes: LogAttributes): AnyValue {
  if (message instanceof Error) {
    return message.message;
  }
  if (!isPlainObject(message)) {
    return typeof message === 'string' ? message : safeStringify(message);
  }

  for (const [key, value] of Object.entries(message)) {
    if (value === undefined || value === null || key in attributes) {
      continue;
    }
    attributes[key] =
      typeof value === 'object' ? safeStringify(value) : (value as AnyValue);
  }

  return typeof message.event === 'string' ? message.event : safeStringify(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isStack(value: string): boolean {
  return value.includes('\n    at ');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
