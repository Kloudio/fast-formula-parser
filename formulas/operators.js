const FormulaError = require('../formulas/error');
const {FormulaHelpers} = require('../formulas/helpers');

const Prefix = {
    unaryOp: (prefixes, value, isArray) => {
        let sign = 1;
        prefixes.forEach(prefix => {
            if (prefix === '+') {
            } else if (prefix === '-') {
                sign = -sign;
            } else {
                throw new Error(`Unrecognized prefix: ${prefix}`);
            }
        });

        if (value == null) {
            value = 0;
        }
        // positive means no changes
        if (sign === 1) {
            return value;
        }
        // negative
        try {
            value = FormulaHelpers.acceptNumber(value, isArray);
        } catch (e) {
            if (e instanceof FormulaError) {
                // parse number fails
                if (Array.isArray(value))
                    value = value[0][0]
            } else
                throw e;
        }

        if (typeof value === "number" && isNaN(value)) return FormulaError.VALUE;
        return -value;
    }
};

const Postfix = {
    percentOp: (value, postfix, isArray) => {
        try {
            value = FormulaHelpers.acceptNumber(value, isArray);
        } catch (e) {
            if (e instanceof FormulaError)
                return e;
            throw e;
        }
        if (postfix === '%') {
            return value / 100;
        }
        throw new Error(`Unrecognized postfix: ${postfix}`);
    }
};

const type2Number = {'boolean': 3, 'string': 2, 'number': 1};

const createNotAvailableError = () => {
    return new FormulaError("#N/A", "A value is not available to the formula or function.");
}

const operateRange = (operation, infix, value1, value2) => {
    const isArrayType1 = value1 instanceof Array;
    const isArrayType2 = value2 instanceof Array;
    if (isArrayType1 && isArrayType2) {
        // Both are ranges

        // Check and normalize dimensions
        const width1 = value1[0].length;
        const width2 = value2[0].length;
        const height1 = value1.length;
        const height2 = value2.length;

        // Default values
        let matrix1 = value1;
        let matrix2 = value2;

        if (width1 !== width2 || height1 !== height2) {
            // Different size matrices, need to pad to make them the same size

            /**
             * If one of the matrices is a row vector of the same width or column
             * vector of the same height as the other matrix, then we want to run
             * the math operation on each row/column of the other matrix, respectively
             * 
             * E.g. [[3,3,3],[4,4,4]] * [[1],[0]] = [[3,3,3],[0,0,0]]
             */
            if (width1 === 1 || width2 === 1) {
                if (width1 !== width2) {
                    if (height1 === height2) {
                        // One of the matrices is a col vector
                        const vector = width1 === 1 ? value1 : value2;
                        const matrix = width1 === 1 ? value2 : value1;
                        
                        // Create a new matrix that's padded with the vector
                        const width = matrix[0].length;
                        const newMatrix = vector.map((row) => {
                            const cellValue = row[0];

                            return Array(width).fill(cellValue);
                        });

                        if (width1 === 1) {
                            // value1 was originally the vector
                            matrix1 = newMatrix;
                            matrix2 = value2;
                        }
                        else {
                            // value2 was originally the vector
                            matrix1 = value1;
                            matrix2 = newMatrix;
                        }
                    }
                }
            }
            else if (height1 === 1 || height2 === 1) {
                if (height1 !== height2) {
                    if (width1 === width2) {
                        // One of the matrices is a col vector
                        const vector = height1 === 1 ? value1 : value2;
                        const matrix = height1 === 1 ? value2 : value1;
                        
                        // Create a new matrix that's padded with the vector
                        const height = matrix.length;
                        const row = vector[0];
                        const newMatrix = vector.concat(Array(height-vector.length).fill(row));

                        if (height1 === 1) {
                            // value1 was originally the vector
                            matrix1 = newMatrix;
                            matrix2 = value2;
                        }
                        else {
                            // value2 was originally the vector
                            matrix1 = value1;
                            matrix2 = newMatrix;
                        }
                    }
                }
            }

            const newWidth1 = matrix1[0].length;
            const newWidth2 = matrix2[0].length;
            const targetWidth = Math.max(newWidth1, newWidth2);
            const newHeight1 = matrix1.length;
            const newHeight2 = matrix2.length;
            const targetHeight = Math.max(newHeight1, newHeight2);

            // Pad the matrices to normalize the dimensions
            const widthDiff = Math.abs(newWidth1 - newWidth2);
            if (widthDiff > 0) {
                let matrixToPadWidth = newWidth1 < newWidth2 ? matrix1 : matrix2;
                matrixToPadWidth.forEach((row, index) => {
                    row = row.concat(Array(widthDiff).fill(createNotAvailableError()));
                    matrixToPadWidth[index] = row;
                });
            }

            const heightDiff = Math.abs(newHeight1 - newHeight2);
            if (heightDiff > 0) {
                let matrixToPadHeight = newHeight1 < newHeight2 ? matrix1 : matrix2;
                matrixToPadHeight = matrixToPadHeight.concat(Array(heightDiff).fill(Array(targetWidth).fill(createNotAvailableError())));
                if (newHeight1 < newHeight2) {
                    matrix1 = matrixToPadHeight;
                }
                else {
                    matrix2 = matrixToPadHeight
                }
            }
        }

        
        // Go through each cell and save comparison
        const result = matrix1.map((row, i) => {
            return row.map((cellValue1 , j) => {
                const cellValue2 = matrix2[i][j];

                return operation(cellValue1, infix, cellValue2, false, false);
            })
        });

        return result;
    }

    const matrix = isArrayType1 ? value1 : value2;
    const scalar = isArrayType1 ? value2 : value1;

    // Else value1 or value2 is a scalar
    // Go through each cell and compare with scalar
    const result = matrix.map((row) => {
        return row.map((cellValue) => {
            return Infix.compareOp(cellValue, infix, scalar, false, false);
        })
    });

    return result;
}

const Infix = {
    compareOp: (value1, infix, value2, isArray1, isArray2) => {
        if (value1 == null) value1 = 0;
        if (value2 == null) value2 = 0;

        if (value1 instanceof FormulaError || value2 instanceof FormulaError) {
            return value1 instanceof FormulaError ? value1 : value2;
        }

        // for array: {1,2,3}, get the first element to compare
        if (isArray1) {
            value1 = value1[0][0];
        }
        if (isArray2) {
            value2 = value2[0][0];
        }

        if (value1 instanceof FormulaError || value2 instanceof FormulaError) {
            return value1 instanceof FormulaError ? value1 : value2;
        }

        const isArrayType1 = value1 instanceof Array;
        const isArrayType2 = value2 instanceof Array;
        if (isArrayType1 || isArrayType2) {
            return operateRange(Infix.compareOp, infix, value1, value2);
        }

        const type1 = typeof value1, type2 = typeof value2;

        if (type1 === type2) {
            // same type comparison
            switch (infix) {
                case '=':
                    return value1 === value2;
                case '>':
                    return value1 > value2;
                case '<':
                    return value1 < value2;
                case '<>':
                    return value1 !== value2;
                case '<=':
                    return value1 <= value2;
                case '>=':
                    return value1 >= value2;
            }
        } else {
            switch (infix) {
                case '=':
                    return false;
                case '>':
                    return type2Number[type1] > type2Number[type2];
                case '<':
                    return type2Number[type1] < type2Number[type2];
                case '<>':
                    return true;
                case '<=':
                    return type2Number[type1] <= type2Number[type2];
                case '>=':
                    return type2Number[type1] >= type2Number[type2];
            }

        }
        throw Error('Infix.compareOp: Should not reach here.');
    },

    concatOp: (value1, infix, value2, isArray1, isArray2) => {
        if (value1 == null) value1 = '';
        if (value2 == null) value2 = '';
        // for array: {1,2,3}, get the first element to concat
        if (isArray1) {
            value1 = value1[0][0];
        }
        if (isArray2) {
            value2 = value2[0][0];
        }

        const type1 = typeof value1, type2 = typeof value2;
        // convert boolean to string
        if (type1 === 'boolean')
            value1 = value1 ? 'TRUE' : 'FALSE';
        if (type2 === 'boolean')
            value2 = value2 ? 'TRUE' : 'FALSE';
        return '' + value1 + value2;
    },

    mathOp: (value1, infix, value2, isArray1, isArray2) => {
        if (value1 == null) value1 = 0;
        if (value2 == null) value2 = 0;

        if (value1 instanceof FormulaError || value2 instanceof FormulaError) {
            return value1 instanceof FormulaError ? value1 : value2;
        }

        const isArrayType1 = value1 instanceof Array;
        const isArrayType2 = value2 instanceof Array;
        if (isArrayType1 || isArrayType2) {
            return operateRange(Infix.mathOp, infix, value1, value2);
        }

        try {
            value1 = FormulaHelpers.acceptNumber(value1, isArray1);
            value2 = FormulaHelpers.acceptNumber(value2, isArray2);
        } catch (e) {
            if (e instanceof FormulaError)
                return e;
            throw e;
        }

        switch (infix) {
            case '+':
                return value1 + value2;
            case '-':
                return value1 - value2;
            case '*':
                return value1 * value2;
            case '/':
                if (value2 === 0)
                    return FormulaError.DIV0;
                return value1 / value2;
            case '^':
                return value1 ** value2;
        }

        throw Error('Infix.mathOp: Should not reach here.');
    },

};

module.exports = {
    Prefix,
    Postfix,
    Infix,
    Operators: {
        compareOp: ['<', '>', '=', '<>', '<=', '>='],
        concatOp: ['&'],
        mathOp: ['+', '-', '*', '/', '^'],
    }
};
