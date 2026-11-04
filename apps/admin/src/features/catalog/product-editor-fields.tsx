import { useId } from 'react';
import Box from '@mui/material/Box';
import FormLabel from '@mui/material/FormLabel';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import type { TextFieldProps } from '@mui/material/TextField';
import { FieldHelp } from '../../components/forms/field-help';
import type { AttributeDefinition } from '../../types/types';
import type { ProductValueInput } from './product-editor-model';

export function ProductField({
  label,
  help,
  helpAction,
  path,
  error,
  required,
  children,
}: {
  label: string;
  help: string;
  helpAction?: { label: string; onClick: () => void };
  path: string;
  error?: string;
  required?: boolean;
  children: (id: string, labelId: string) => React.ReactNode;
}) {
  const id = useId(),
    labelId = id + '-label';
  return (
    <Box
      data-field-path={path}
      sx={{
        minWidth: 0,
        '& .MuiOutlinedInput-root': { bgcolor: 'var(--surface)', borderRadius: 2, minHeight: 46 },
        '& .MuiOutlinedInput-root:hover:not(.Mui-disabled) .MuiOutlinedInput-notchedOutline': {
          borderColor: 'text.secondary',
        },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
        '& .Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: 'error.main' },
        '& .MuiInputBase-input': { fontSize: { xs: 16, sm: 14 } },
        '& .MuiFormHelperText-root': { mt: 0.5, fontSize: 12 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <FormLabel
          id={labelId}
          htmlFor={id}
          required={required}
          error={Boolean(error)}
          sx={{ fontSize: 13, fontWeight: 600, color: error ? 'error.main' : 'text.primary' }}
        >
          {label}
        </FormLabel>
        {help && <FieldHelp label={label} description={help} action={helpAction} />}
      </Box>
      {children(id, labelId)}
    </Box>
  );
}
export function ProductTextField({
  label,
  help = '',
  helpAction,
  path,
  error,
  ...props
}: Omit<TextFieldProps, 'error' | 'label'> & {
  label: string;
  help?: string;
  helpAction?: { label: string; onClick: () => void };
  path: string;
  error?: string;
}) {
  return (
    <ProductField
      label={label}
      help={help}
      helpAction={helpAction}
      path={path}
      error={error}
      required={props.required}
    >
      {(id, labelId) => (
        <TextField
          {...props}
          id={id}
          error={Boolean(error)}
          helperText={error || props.helperText}
          slotProps={{
            ...props.slotProps,
            ...(props.select
              ? {
                  select: {
                    labelId,
                    displayEmpty: true,
                    ...(typeof props.slotProps?.select === 'object' ? props.slotProps.select : {}),
                  },
                }
              : {}),
            htmlInput: {
              'aria-labelledby': labelId,
              ...(typeof props.slotProps?.htmlInput === 'object' ? props.slotProps.htmlInput : {}),
            },
          }}
        />
      )}
    </ProductField>
  );
}
export function ProductAttributeField({
  definition,
  value,
  onChange,
  path,
  error,
  required = false,
  help = '',
  disabled = false,
}: {
  definition: AttributeDefinition;
  value: ProductValueInput | undefined;
  onChange: (value: ProductValueInput | null) => void;
  path: string;
  error?: string;
  required?: boolean;
  help?: string;
  disabled?: boolean;
}) {
  const name = definition.translations.find((t) => t.locale === 'fa')?.name || definition.key;
  const label = name + (definition.unit ? ' (' + definition.unit + ')' : '');
  const base = {
    disabled,
    label,
    path,
    error,
    required,
    help:
      help ||
      'مقدار ' +
        name +
        ' از نوع ' +
        {
          Text: 'متن',
          Number: 'عدد',
          Bool: 'بله/خیر',
          Select: 'انتخاب یک گزینه',
          MultiSelect: 'انتخاب چند گزینه',
        }[definition.dataType] +
        ' است. نوع، گزینه‌ها و اجباری‌بودن از تنظیمات فیلدهای همین دسته مدیریت می‌شوند.',
  };
  if (definition.dataType === 'Select' || definition.dataType === 'Bool')
    return (
      <ProductTextField
        {...base}
        select
        value={
          definition.dataType === 'Bool'
            ? value?.bool == null
              ? ''
              : String(value.bool)
            : (value?.optionId ?? '')
        }
        onChange={(event) =>
          onChange(
            event.target.value === ''
              ? null
              : definition.dataType === 'Bool'
                ? { attributeId: definition.id, bool: event.target.value === 'true' }
                : { attributeId: definition.id, optionId: event.target.value },
          )
        }
      >
        <MenuItem value="">تعیین نشده</MenuItem>
        {definition.dataType === 'Bool'
          ? [
              <MenuItem key="yes" value="true">
                بله
              </MenuItem>,
              <MenuItem key="no" value="false">
                خیر
              </MenuItem>,
            ]
          : definition.options.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.labelFa}
              </MenuItem>
            ))}
      </ProductTextField>
    );
  if (definition.dataType === 'MultiSelect')
    return (
      <ProductTextField
        {...base}
        select
        value={value?.optionIds ?? []}
        slotProps={{ select: { multiple: true } }}
        onChange={(event) => {
          const selected = event.target.value;
          const options =
            typeof selected === 'string' ? selected.split(',') : (selected as string[]);
          onChange(options.length ? { attributeId: definition.id, optionIds: options } : null);
        }}
      >
        {definition.options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.labelFa}
          </MenuItem>
        ))}
      </ProductTextField>
    );
  return (
    <ProductTextField
      {...base}
      type={definition.dataType === 'Number' ? 'number' : 'text'}
      value={definition.dataType === 'Number' ? (value?.number ?? '') : (value?.textFa ?? '')}
      slotProps={{
        htmlInput: definition.dataType === 'Number' ? { step: 'any' } : { maxLength: 2000 },
      }}
      onChange={(event) => {
        const next = event.target.value;
        onChange(
          next === ''
            ? null
            : definition.dataType === 'Number'
              ? { attributeId: definition.id, number: Number(next) }
              : { attributeId: definition.id, textFa: next, textEn: value?.textEn || next },
        );
      }}
    />
  );
}
