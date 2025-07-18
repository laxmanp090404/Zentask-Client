const Task = require('../model/taskModel');
const Column = require('../model/columnModel');
const Board = require('../model/boardModel'); // FIX: Add this line to import the Board model
const mongoose = require('mongoose'); // Make sure mongoose is imported

// @desc    Get all tasks for a specific column
// @route   GET /api/columns/:columnId/tasks
// @access  Private
const getTasks = async (req, res) => {
  try {
    const { columnId } = req.params;

    // 1. Find the column to get its parent board ID
    const column = await Column.findById(columnId);
    if (!column) {
      return res.status(404).json({ message: 'Column not found' });
    }

    // 2. Find the parent board for authorization check
    const board = await Board.findById(column.boardId);
    if (!board) {
      // This case should be rare but is good practice to handle
      return res.status(404).json({ message: 'Parent board not found' });
    }

    // 3. Verify the user owns the board
    if (board.createdBy.toString() !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized for this board' });
    }

    // 4. If authorized, fetch the tasks
    const tasks = await Task.find({ columnId })
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ createdAt: 'asc' }); // or any other order you prefer

    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ message: `Error fetching tasks: ${error.message}` });
  }
};

// @desc    Create a new task for a column
// @route   POST /api/columns/:columnId/tasks
// @access  Private
const createTask = async (req, res) => {
  try {
    const { title, description, priority, dueDate, assignedTo } = req.body;
    const { columnId } = req.params;

    const column = await Column.findById(columnId);
    if (!column) {
      return res.status(404).json({ message: 'Column not found' });
    }

    const board = await Board.findById(column.boardId);
    if (board.createdBy.toString() !== req.user.id) {
        return res.status(401).json({ message: 'User not authorized for this board' });
    }

    const task = await Task.create({
      title,
      description,
      priority,
      dueDate,
      assignedTo: assignedTo?.id || null,
      columnId,
      createdBy: req.user.id,
    });

    column.tasks.push(task._id);
    await column.save();

    const populatedTask = await task.populate([
        { path: 'createdBy', select: 'name' },
        { path: 'assignedTo', select: 'name' }
    ]);

    res.status(201).json(populatedTask);
  } catch (error) {
    res.status(500).json({ message: `Error creating task: ${error.message}` });
  }
};

// @desc    Move a task within or between columns
// @route   PUT /api/tasks/:id/move
// @access  Private
const moveTask = async (req, res) => {
  const { destColumnId, destIndex } = req.body;
  const { id: taskId } = req.params;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const task = await Task.findById(taskId).session(session);
    if (!task) {
      throw new Error('Task not found');
    }

    const sourceColumnId = task.columnId;

    // Authorization check (user must own the board)
    const sourceColumnForAuth = await Column.findById(sourceColumnId).session(session);
    const board = await Board.findById(sourceColumnForAuth.boardId).session(session);
    if (board.createdBy.toString() !== req.user.id) {
      throw new Error('User not authorized');
    }

    // 1. Remove task from the source column's task array
    await Column.findByIdAndUpdate(
      sourceColumnId,
      { $pull: { tasks: taskId } },
      { session }
    );

    // 2. Add task to the destination column's task array at the correct position
    await Column.findByIdAndUpdate(
      destColumnId,
      {
        $push: {
          tasks: {
            $each: [taskId],
            $position: destIndex,
          },
        },
      },
      { session }
    );

    // 3. Update the task's own columnId field
    task.columnId = destColumnId;
    await task.save({ session });

    await session.commitTransaction();
    res.status(200).json({ message: 'Task moved successfully' });

  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message || 'Failed to move task' });
  } finally {
    session.endSession();
  }
};

// @desc    Update a task
// @route   PUT /api/tasks/:id
// @access  Private
const updateTask = async (req, res) => {
  try {
    const { 
      title, 
      description, 
      columnId, 
      priority, 
      dueDate, 
      assignedTo, 
      order 
    } = req.body;
    
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    // Validate column if changing
    if (columnId && columnId !== task.columnId.toString()) {
      const newColumn = await Column.findById(columnId);
      if (!newColumn) {
        return res.status(404).json({ message: 'Column not found' });
      }
    }
    
    // Check if user has access to the board
    const column = await Column.findById(task.columnId);
    if (!column) {
      return res.status(404).json({ message: 'Column not found' });
    }
    
    const board = await Board.findById(column.boardId);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }
    
    if (board.createdBy.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    
    // Update task fields
    task.title = title || task.title;
    task.description = description !== undefined ? description : task.description;
    task.columnId = columnId || task.columnId;
    task.priority = priority || task.priority;
    task.dueDate = dueDate !== undefined ? dueDate : task.dueDate;
    task.assignedTo = assignedTo !== undefined ? assignedTo : task.assignedTo;
    
    if (order !== undefined) {
      task.order = order;
    }
    
    const updatedTask = await task.save();
    
    res.status(200).json(updatedTask);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a task
// @route   DELETE /api/tasks/:id
// @access  Private
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    // Check if user has access to the board
    const column = await Column.findById(task.columnId);
    if (!column) {
      return res.status(404).json({ message: 'Column not found' });
    }
    
    const board = await Board.findById(column.boardId);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }
    
    if (board.createdBy.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    
    await task.deleteOne();
    
    res.status(200).json({ id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Make sure to export all your functions
module.exports = {
  getTasks,
  createTask,
  moveTask, // Add this
  updateTask,
  deleteTask,
};