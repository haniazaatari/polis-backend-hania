"""
Named Matrix implementation for Pol.is math module.

This module provides a data structure for matrices with named rows and columns,
specifically optimized for the Pol.is voting data representation.
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Union, Optional, Tuple, Any, Set


class IndexHash:
    """
    Maintains an ordered index of names with fast lookup.
    Similar to the Clojure IndexHash implementation.
    """
    
    def __init__(self, names: Optional[List[Any]] = None):
        """
        Initialize an IndexHash with optional initial names.
        
        Args:
            names: Optional list of initial names
        """
        self._names = [] if names is None else list(names)
        self._index_hash = {name: idx for idx, name in enumerate(self._names)}
        
    def get_names(self) -> List[Any]:
        """Return the ordered list of names."""
        return self._names.copy()
    
    def next_index(self) -> int:
        """Return the next index value that would be assigned."""
        return len(self._names)
    
    def index(self, name: Any) -> Optional[int]:
        """
        Get the index for a given name, or None if not found.
        
        Args:
            name: The name to look up
            
        Returns:
            The index if found, None otherwise
        """
        return self._index_hash.get(name)
    
    def append(self, name: Any) -> 'IndexHash':
        """
        Add a new name to the index.
        
        Args:
            name: The name to add
            
        Returns:
            A new IndexHash with the added name
        """
        if name in self._index_hash:
            return self
            
        new_index = IndexHash(self._names)
        new_index._names.append(name)
        new_index._index_hash[name] = len(new_index._names) - 1
        return new_index
    
    def append_many(self, names: List[Any]) -> 'IndexHash':
        """
        Add multiple names to the index.
        
        Args:
            names: List of names to add
            
        Returns:
            A new IndexHash with the added names
        """
        result = self
        for name in names:
            result = result.append(name)
        return result
    
    def subset(self, names: List[Any]) -> 'IndexHash':
        """
        Create a subset of the index with only the specified names.
        
        Args:
            names: List of names to include in the subset
            
        Returns:
            A new IndexHash containing only the specified names
        """
        # Filter names that exist in the current index
        valid_names = [name for name in names if name in self._index_hash]
        return IndexHash(valid_names)
    
    def __len__(self) -> int:
        """Return the number of names in the index."""
        return len(self._names)
    
    def __contains__(self, name: Any) -> bool:
        """Check if a name is in the index."""
        return name in self._index_hash


class NamedMatrix:
    """
    A matrix with named rows and columns.
    
    This is the Python equivalent of the Clojure NamedMatrix implementation,
    using pandas DataFrame as the underlying storage.
    """
    
    def __init__(self, 
                 matrix: Optional[Union[np.ndarray, pd.DataFrame]] = None,
                 rownames: Optional[List[Any]] = None,
                 colnames: Optional[List[Any]] = None,
                 enforce_numeric: bool = True):
        """
        Initialize a NamedMatrix with optional initial data.
        
        Args:
            matrix: Initial matrix data (numpy array or pandas DataFrame)
            rownames: List of row names
            colnames: List of column names
            enforce_numeric: Whether to enforce numeric values (convert to float)
        """
        # Initialize row and column indices
        self._row_index = IndexHash(rownames)
        self._col_index = IndexHash(colnames)
        
        # Initialize the matrix data
        if matrix is None:
            # Create an empty DataFrame
            self._matrix = pd.DataFrame(
                index=self._row_index.get_names(),
                columns=self._col_index.get_names()
            )
        elif isinstance(matrix, pd.DataFrame):
            # If DataFrame is provided, use it directly
            self._matrix = matrix.copy()
            # Update indices if provided
            if rownames is not None:
                self._matrix.index = rownames
            else:
                # Use DataFrame's index as rownames
                rownames = list(matrix.index)
                self._row_index = IndexHash(rownames)
                
            if colnames is not None:
                self._matrix.columns = colnames
            else:
                # Use DataFrame's columns as colnames
                colnames = list(matrix.columns)
                self._col_index = IndexHash(colnames)
        else:
            # Convert numpy array to DataFrame
            rows = rownames if rownames is not None else range(matrix.shape[0])
            cols = colnames if colnames is not None else range(matrix.shape[1])
            self._matrix = pd.DataFrame(
                matrix,
                index=rows,
                columns=cols
            )
        
        # Ensure numeric data if requested
        if enforce_numeric:
            self._convert_to_numeric()
    
    def _convert_to_numeric(self) -> None:
        """
        Convert all data in the matrix to numeric (float) values.
        Non-convertible values are replaced with NaN.
        """
        # Check if the matrix is empty
        if self._matrix.empty:
            return
            
        # Check if the matrix has any columns
        if len(self._matrix.columns) == 0:
            return
            
        # Check if the matrix has any rows
        if len(self._matrix.index) == 0:
            return
        
        # Check if the matrix is already numeric
        try:
            if pd.api.types.is_numeric_dtype(self._matrix.dtypes.iloc[0]) and not self._matrix.dtypes.iloc[0] == np.dtype('O'):
                return
        except (IndexError, AttributeError):
            # Handle empty DataFrames or other issues
            return
            
        # If matrix has object or non-numeric type, convert manually
        numeric_matrix = np.zeros(self._matrix.shape, dtype=float)
        
        for i in range(self._matrix.shape[0]):
            for j in range(self._matrix.shape[1]):
                try:
                    val = self._matrix.iloc[i, j]
                    
                    if pd.isna(val) or val is None:
                        numeric_matrix[i, j] = np.nan
                    else:
                        try:
                            # Try to convert to float
                            numeric_value = float(val)
                            
                            # For vote values, normalize to -1.0, 0.0, or 1.0
                            if numeric_value > 0:
                                numeric_matrix[i, j] = 1.0
                            elif numeric_value < 0:
                                numeric_matrix[i, j] = -1.0
                            else:
                                numeric_matrix[i, j] = 0.0
                        except (ValueError, TypeError):
                            # If conversion fails, use NaN
                            numeric_matrix[i, j] = np.nan
                except IndexError:
                    # Handle out of bounds access
                    continue
        
        # Create a new DataFrame with the numeric values
        self._matrix = pd.DataFrame(
            numeric_matrix,
            index=self._matrix.index,
            columns=self._matrix.columns
        )
    
    @property
    def matrix(self) -> pd.DataFrame:
        """Get the underlying DataFrame."""
        return self._matrix
    
    @property
    def values(self) -> np.ndarray:
        """Get the matrix as a numpy array."""
        return self._matrix.values
    
    def rownames(self) -> List[Any]:
        """Get the list of row names."""
        return self._row_index.get_names()
    
    def colnames(self) -> List[Any]:
        """Get the list of column names."""
        return self._col_index.get_names()
    
    def get_row_index(self) -> IndexHash:
        """Get the row index object."""
        return self._row_index
    
    def get_col_index(self) -> IndexHash:
        """Get the column index object."""
        return self._col_index
    
    def update(self, 
               row: Any, 
               col: Any, 
               value: Any) -> 'NamedMatrix':
        """
        Update a single value in the matrix, adding new rows/columns as needed.
        
        Args:
            row: Row name
            col: Column name
            value: New value
            
        Returns:
            A new NamedMatrix with the updated value
        """
        # Convert value to numeric if needed
        if value is not None:
            try:
                # Try to convert to float
                numeric_value = float(value)
                
                # For vote values, normalize to -1.0, 0.0, or 1.0
                if numeric_value > 0:
                    value = 1.0
                elif numeric_value < 0:
                    value = -1.0
                else:
                    value = 0.0
            except (ValueError, TypeError):
                # If conversion fails, use NaN
                value = np.nan
        
        # Make a copy of the current matrix
        new_matrix = self._matrix.copy()
        
        # Handle the case of empty matrix
        if len(new_matrix.columns) == 0 and col is not None:
            # Initialize with a single column
            new_matrix[col] = np.nan
            new_col_index = self._col_index.append(col)
        else:
            new_col_index = self._col_index
            
            # Add column if it doesn't exist
            if col not in new_matrix.columns:
                new_matrix[col] = np.nan
                new_col_index = new_col_index.append(col)
        
        # Add row if it doesn't exist
        if row not in new_matrix.index:
            new_matrix.loc[row] = np.nan
            new_row_index = self._row_index.append(row)
        else:
            new_row_index = self._row_index
        
        # Update the value
        new_matrix.loc[row, col] = value
        
        # Create a new NamedMatrix with updated data
        result = NamedMatrix.__new__(NamedMatrix)
        result._matrix = new_matrix
        result._row_index = new_row_index
        result._col_index = new_col_index
        return result
    
    def update_many(self, 
                   updates: List[Tuple[Any, Any, Any]]) -> 'NamedMatrix':
        """
        Update multiple values in the matrix.
        
        Args:
            updates: List of (row, col, value) tuples
            
        Returns:
            A new NamedMatrix with the updated values
        """
        result = self
        for row, col, value in updates:
            result = result.update(row, col, value)
        return result
    
    def rowname_subset(self, rownames: List[Any]) -> 'NamedMatrix':
        """
        Create a subset of the matrix with only the specified rows.
        
        Args:
            rownames: List of row names to include
            
        Returns:
            A new NamedMatrix with only the specified rows
        """
        # Filter for rows that exist in the matrix
        valid_rows = [row for row in rownames if row in self._matrix.index]
        
        if not valid_rows:
            # Return an empty matrix with the same columns
            return NamedMatrix(
                pd.DataFrame(columns=self.colnames()),
                rownames=[],
                colnames=self.colnames()
            )
        
        # Create a subset of the matrix
        subset_df = self._matrix.loc[valid_rows]
        
        # Create a new NamedMatrix with the subset
        result = NamedMatrix.__new__(NamedMatrix)
        result._matrix = subset_df
        result._row_index = self._row_index.subset(valid_rows)
        result._col_index = self._col_index
        return result
    
    def colname_subset(self, colnames: List[Any]) -> 'NamedMatrix':
        """
        Create a subset of the matrix with only the specified columns.
        
        Args:
            colnames: List of column names to include
            
        Returns:
            A new NamedMatrix with only the specified columns
        """
        # Filter for columns that exist in the matrix
        valid_cols = [col for col in colnames if col in self._matrix.columns]
        
        if not valid_cols:
            # Return an empty matrix with the same rows
            return NamedMatrix(
                pd.DataFrame(index=self.rownames()),
                rownames=self.rownames(),
                colnames=[]
            )
        
        # Create a subset of the matrix
        subset_df = self._matrix[valid_cols]
        
        # Create a new NamedMatrix with the subset
        result = NamedMatrix.__new__(NamedMatrix)
        result._matrix = subset_df
        result._row_index = self._row_index
        result._col_index = self._col_index.subset(valid_cols)
        return result
    
    def get_row_by_name(self, row_name: Any) -> np.ndarray:
        """
        Get a row of the matrix by name.
        
        Args:
            row_name: The name of the row
            
        Returns:
            The row as a numpy array
        """
        if row_name not in self._matrix.index:
            raise KeyError(f"Row name '{row_name}' not found")
        return self._matrix.loc[row_name].values
    
    def get_col_by_name(self, col_name: Any) -> np.ndarray:
        """
        Get a column of the matrix by name.
        
        Args:
            col_name: The name of the column
            
        Returns:
            The column as a numpy array
        """
        if col_name not in self._matrix.columns:
            raise KeyError(f"Column name '{col_name}' not found")
        return self._matrix[col_name].values
    
    def zero_out_columns(self, colnames: List[Any]) -> 'NamedMatrix':
        """
        Set all values in the specified columns to zero.
        
        Args:
            colnames: List of column names to zero out
            
        Returns:
            A new NamedMatrix with zeroed columns
        """
        # Make a copy
        new_matrix = self._matrix.copy()
        
        # Zero out columns that exist
        valid_cols = [col for col in colnames if col in new_matrix.columns]
        for col in valid_cols:
            new_matrix[col] = 0
            
        # Create a new NamedMatrix with updated data
        result = NamedMatrix.__new__(NamedMatrix)
        result._matrix = new_matrix
        result._row_index = self._row_index
        result._col_index = self._col_index
        return result
    
    def inv_rowname_subset(self, rownames: List[Any]) -> 'NamedMatrix':
        """
        Create a subset excluding the specified rows.
        
        Args:
            rownames: List of row names to exclude
            
        Returns:
            A new NamedMatrix without the specified rows
        """
        exclude_set = set(rownames)
        include_rows = [row for row in self.rownames() if row not in exclude_set]
        return self.rowname_subset(include_rows)
    
    def __repr__(self) -> str:
        """
        String representation of the NamedMatrix.
        """
        return f"NamedMatrix(rows={len(self.rownames())}, cols={len(self.colnames())})"
    
    def __str__(self) -> str:
        """
        Human-readable string representation.
        """
        return (f"NamedMatrix with {len(self.rownames())} rows and "
                f"{len(self.colnames())} columns\n{self._matrix}")


# Utility functions

def create_named_matrix(matrix_data: Optional[Union[np.ndarray, List[List[Any]]]] = None,
                        rownames: Optional[List[Any]] = None,
                        colnames: Optional[List[Any]] = None) -> NamedMatrix:
    """
    Create a NamedMatrix from data.
    
    Args:
        matrix_data: Initial matrix data (numpy array or nested lists)
        rownames: List of row names
        colnames: List of column names
        
    Returns:
        A new NamedMatrix
    """
    if matrix_data is not None and not isinstance(matrix_data, np.ndarray):
        matrix_data = np.array(matrix_data)
    return NamedMatrix(matrix_data, rownames, colnames)