package restart.data;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import org.iq80.leveldb.*;
import static org.iq80.leveldb.impl.Iq80DBFactory.*;
import java.io.*;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;

@Stateless
@Default
public class LevelDB implements ILevelDB {

  private String fileName = "testLevelDb3";
  
  public <R> R transaction(Function<DB, R> action) throws IOException {
    Options options = new Options();
    options.createIfMissing(true);
    options.compressionType(CompressionType.NONE);
    DB db = null;
    try {
      db = factory.open(new File(fileName), options);
      return action.apply(db);
    } finally {
      // Make sure you close the DB.
      db.close();
    }
  }
  
//  public <R> R snapshot(DB db, Function<ReadOptions, R> action) throws IOException {
//    ReadOptions readOptions = new ReadOptions();
//    readOptions.snapshot(db.getSnapshot());
//    try {
//      return action.apply(readOptions);
//    } finally {
//      // Make sure you close the snapshot to avoid resource leaks.
//      readOptions.snapshot().close();
//    }
//  }
//
//  public <R> R atomicWrite(DB db, Function<WriteBatch, R> action) throws IOException {
//    WriteBatch batch = db.createWriteBatch();
//    R result = action.apply(batch);
//    try {
//    } finally {
//      db.write(batch);
//      
//      // Make sure you close the batch to avoid resource leaks.
//      batch.close();
//    }
//    return result;
//  }
//
//  public <R> R withIterator(DB db, ReadOptions readOptions, Function<DBIterator, R> action) throws IOException {
//    DBIterator iterator;
//    if(readOptions == null) {
//      iterator = db.iterator();
//    } else {
//      iterator = db.iterator(readOptions);
//    }
//    try {
//      return action.apply(iterator);
//    } finally {
//      // Make sure you close the iterator to avoid resource leaks.
//      iterator.close();
//    }
//  }

}


