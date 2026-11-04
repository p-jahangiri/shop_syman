import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { CircleHelp, ArrowUpLeft } from 'lucide-react';

export function FieldHelp({
  label,
  description,
  action,
}: {
  label: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  return (
    <>
      <Tooltip title={'راهنمای ' + label}>
        <IconButton
          data-field-help
          type="button"
          size="small"
          aria-label={'راهنمای ' + label}
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? id : undefined}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
        >
          <CircleHelp size={16} aria-hidden="true" />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{
          paper: {
            id,
            role: 'dialog',
            'aria-label': 'راهنمای ' + label,
            sx: { p: 2, maxWidth: 340, m: 1 },
          },
        }}
      >
        <Typography variant="subtitle2" gutterBottom>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ lineHeight: 2, whiteSpace: 'pre-line' }}>
          {description}
        </Typography>
        {action && (
          <Box sx={{ mt: 1.5 }}>
            <Button
              type="button"
              size="small"
              endIcon={<ArrowUpLeft size={15} />}
              onClick={() => {
                setAnchor(null);
                action.onClick();
              }}
            >
              {action.label}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}
